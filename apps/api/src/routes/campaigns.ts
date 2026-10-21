import type { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { Prisma, type CallDisposition } from "@prisma/client";
import { parse } from "csv-parse/sync";
import { z } from "zod";
import {
  campaignCreateSchema,
  SMS_PER_MINUTE_DEFAULT,
  smsDelayMsForRate,
  smsPerMinuteSchema,
} from "@powerdialer/shared";
import { prisma } from "../db.js";
import { toE164 } from "../lib/phone.js";
import { enqueueDialNext, enqueueSms, enqueueSmsCampaignTick } from "../queueEnqueue.js";
import { enforceFunctionAccess } from "../functionAccess.js";
import {
  buildZoomPhoneCallUrl,
  readPreferredIntegrationKey,
  usesZoomPhoneAgentDial,
} from "../lib/zoomPhoneAgent.js";
import { campaignMediaToken, verifyCampaignMediaToken } from "../lib/webhookToken.js";
import {
  canAccessCampaign,
  campaignWhereForUser,
  requireOrg,
  writeAuditLog,
  type OrgAuth,
} from "../lib/orgAccess.js";
import { getOrgIntegrationPreference, upsertOrgSmsPerMinute } from "../lib/orgPreferences.js";

const contactsJsonSchema = z.object({
  rows: z.array(
    z.object({
      phone: z.string(),
      name: z.string().optional(),
      metadata: z.record(z.unknown()).optional(),
    }),
  ),
});

const smsBodySchema = z.object({
  body: z.string().min(1).max(1600),
  contactIds: z.array(z.string()).optional(),
  /** Optional override; otherwise workspace IntegrationPreference.smsPerMinute is used (max 45). */
  smsPerMinute: smsPerMinuteSchema.optional(),
});

const smsStartBodySchema = z.object({
  /** Optional message override; defaults to the campaign SMS template. */
  body: z.string().min(1).max(1600).optional(),
  smsPerMinute: smsPerMinuteSchema.optional(),
});

async function resolveSmsPerMinute(
  organizationId: string,
  requested?: number,
): Promise<{ smsPerMinute: number; spacingMs: number }> {
  const preference = await getOrgIntegrationPreference(organizationId);
  const smsPerMinute = requested ?? preference.smsPerMinute ?? SMS_PER_MINUTE_DEFAULT;
  return { smsPerMinute, spacingMs: smsDelayMsForRate(smsPerMinute) };
}

async function requireCampaignAccess(
  req: { auth: OrgAuth | null },
  reply: { code: (n: number) => { send: (b: unknown) => unknown } },
  campaignId: string,
) {
  const auth = await requireOrg(req, reply as never);
  if (!auth) return null;
  if (!(await canAccessCampaign(auth, campaignId))) {
    reply.code(404).send({ error: "Not found" });
    return null;
  }
  return auth;
}

async function enqueueCampaignSmsJobs(input: {
  campaignId: string;
  contactIds: string[];
  body: string;
  smsPerMinute: number;
  spacingMs: number;
}): Promise<string[]> {
  let delay = 0;
  const jobs: string[] = [];
  for (let i = 0; i < input.contactIds.length; i++) {
    const contactId = input.contactIds[i]!;
    await enqueueSms(
      { campaignId: input.campaignId, contactId, body: input.body },
      { delay, jobId: `sms-${input.campaignId}-${contactId}-${Date.now()}-${i}` },
    );
    jobs.push(contactId);
    delay += input.spacingMs;
  }
  return jobs;
}

const agentDispositionSchema = z.object({
  contactId: z.string().min(1),
  disposition: z.enum(["COMPLETED", "NO_ANSWER", "BUSY", "FAILED", "CANCELED"]),
});

const agentSkipSchema = z.object({
  contactId: z.string().min(1),
});

type CampaignWithOptionalAudio = {
  voicemailAudioData?: string | null;
  voicemailAudioMimeType?: string | null;
} & Record<string, unknown>;

function parseAudioDataUrl(dataUrl: string | undefined): { mimeType: string; base64: string } | null {
  if (!dataUrl?.trim()) return null;
  const match = /^data:(audio\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
  if (!match) {
    throw new Error("Recorded voicemail must be sent as a valid audio data URL.");
  }
  return { mimeType: match[1], base64: match[2] };
}

function publicCampaign<T extends CampaignWithOptionalAudio>(campaign: T): Omit<T, "voicemailAudioData" | "voicemailAudioMimeType"> & {
  hasVoicemailAudio: boolean;
} {
  const { voicemailAudioData, voicemailAudioMimeType, ...rest } = campaign;
  return {
    ...rest,
    hasVoicemailAudio: Boolean(voicemailAudioData && voicemailAudioMimeType),
  };
}

/**
 * Scalar columns for read endpoints. Excludes voicemailAudioData (a base64
 * blob that can be megabytes) so list/detail polling stays fast; the mime type
 * doubles as a cheap "has audio" flag since both are always written together.
 */
const campaignScalarSelect = {
  id: true,
  name: true,
  kind: true,
  status: true,
  startedByUserId: true,
  fromPhone: true,
  voiceMessage: true,
  voicemailDropEnabled: true,
  voicemailMessage: true,
  voicemailAudioMimeType: true,
  smsTemplate: true,
  consentNotes: true,
  consentAttestedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CampaignSelect;

function publicCampaignLite<T extends { voicemailAudioMimeType: string | null }>(
  campaign: T,
): Omit<T, "voicemailAudioMimeType"> & { hasVoicemailAudio: boolean } {
  const { voicemailAudioMimeType, ...rest } = campaign;
  return { ...rest, hasVoicemailAudio: Boolean(voicemailAudioMimeType) };
}

function publicBaseUrl(req: { headers: Record<string, unknown>; protocol?: string; url?: string }): string {
  const xfProto = req.headers["x-forwarded-proto"];
  const proto = (Array.isArray(xfProto) ? xfProto[0] : xfProto) || req.protocol || "http";
  const xfHost = req.headers["x-forwarded-host"];
  const host =
    (Array.isArray(xfHost) ? xfHost[0] : xfHost) ||
    (typeof req.headers.host === "string" ? req.headers.host : "localhost");
  return `${proto}://${host}`;
}

export async function campaignRoutes(app: FastifyInstance): Promise<void> {
  await app.register(multipart, { limits: { fileSize: 100 * 1024 * 1024 } });

  app.post("/campaigns", async (req, reply) => {
    if (!(await enforceFunctionAccess(req as { auth: { sub: string; role: "user" | "admin" | "owner" } | null }, reply, "campaign_create"))) {
      return;
    }
    // Normalize caller ID before schema validation so (202) 555-0101 works.
    const rawBody =
      req.body && typeof req.body === "object" && !Array.isArray(req.body)
        ? { ...(req.body as Record<string, unknown>) }
        : {};
    if (typeof rawBody.fromPhone === "string") {
      const normalized = toE164(rawBody.fromPhone);
      if (!normalized) {
        return reply.code(400).send({
          error:
            "Sending number is invalid. Use a full number with country code, e.g. +12025550101 (US).",
        });
      }
      rawBody.fromPhone = normalized;
    }
    const parsedBody = campaignCreateSchema.safeParse(rawBody);
    if (!parsedBody.success) {
      const fromIssue = parsedBody.error.issues.find((i) => i.path.includes("fromPhone"));
      return reply.code(400).send({
        error: fromIssue
          ? "Sending number must look like +12025550101 (include the + and country code)."
          : parsedBody.error.issues[0]?.message ?? "Validation failed",
        details: parsedBody.error.flatten(),
      });
    }
    const body = parsedBody.data;
    let voicemailAudio: { mimeType: string; base64: string } | null = null;
    try {
      voicemailAudio = body.kind === "DIAL" ? parseAudioDataUrl(body.voicemailAudioDataUrl) : null;
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : "Recorded voicemail audio is invalid.",
      });
    }
    const voiceMessage = body.kind === "DIAL" ? body.voiceMessage : "";
    const smsTemplate = body.kind === "DIAL" ? body.smsTemplate : body.smsTemplate;
    const voicemailDropEnabled = body.kind === "DIAL" ? Boolean(body.voicemailDropEnabled) : false;
    const auth = await requireOrg(req, reply);
    if (!auth) return;
    const campaign = await prisma.campaign.create({
      data: {
        organizationId: auth.orgId,
        name: body.name,
        kind: body.kind,
        fromPhone: body.fromPhone,
        voiceMessage,
        voicemailDropEnabled,
        voicemailMessage:
          body.kind === "DIAL" && voicemailDropEnabled ? body.voicemailMessage?.trim() || null : null,
        voicemailAudioData:
          body.kind === "DIAL" && voicemailDropEnabled ? voicemailAudio?.base64 ?? null : null,
        voicemailAudioMimeType:
          body.kind === "DIAL" && voicemailDropEnabled ? voicemailAudio?.mimeType ?? null : null,
        smsTemplate,
        consentNotes: body.consentNotes,
        consentAttestedAt: new Date(),
        status: "DRAFT",
      },
    });
    await writeAuditLog({
      organizationId: auth.orgId,
      actorUserId: auth.sub,
      action: "campaign.created",
      entityType: "Campaign",
      entityId: campaign.id,
    });
    return reply.code(201).send(publicCampaign(campaign));
  });

  app.get("/campaigns", async (req, reply) => {
    const auth = await requireOrg(req, reply);
    if (!auth) return;
    const where = await campaignWhereForUser(auth);
    const rows = await prisma.campaign.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: { ...campaignScalarSelect, _count: { select: { contacts: true } } },
    });
    return rows.map((row) => publicCampaignLite(row));
  });

  app.get("/campaigns/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const auth = await requireCampaignAccess(req, reply, id);
    if (!auth) return;
    const c = await prisma.campaign.findFirst({
      where: { id, organizationId: auth.orgId },
      select: {
        ...campaignScalarSelect,
        contacts: {
          orderBy: { createdAt: "asc" },
          take: 2_000,
          select: { id: true, phoneE164: true, name: true, status: true },
        },
        _count: { select: { contacts: true, callAttempts: true, smsAttempts: true } },
      },
    });
    if (!c) return reply.code(404).send({ error: "Not found" });
    const preferredIntegration = await readPreferredIntegrationKey();
    const agentDialMode = c.kind === "DIAL" && (await usesZoomPhoneAgentDial());
    const nextPending = agentDialMode
      ? c.contacts.find((row) => row.status === "PENDING")
      : undefined;
    const publicView = publicCampaignLite(c);
    return {
      ...publicView,
      voicemailRecordingPath: publicView.hasVoicemailAudio
        ? `/campaigns/${c.id}/voicemail-recording?t=${campaignMediaToken(c.id)}`
        : null,
      preferredIntegration,
      agentDialMode,
      nextContact: nextPending
        ? {
            id: nextPending.id,
            phoneE164: nextPending.phoneE164,
            name: nextPending.name,
            zoomCallUrl: buildZoomPhoneCallUrl(nextPending.phoneE164, c.fromPhone),
          }
        : null,
    };
  });

  app.get("/campaigns/:id/voicemail-recording", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const token = (req.query as { t?: string }).t;
    if (!req.auth?.sub && !verifyCampaignMediaToken(id, token)) {
      return reply.code(403).send({ error: "Forbidden" });
    }
    const campaign = await prisma.campaign.findUnique({
      where: { id },
      select: { voicemailAudioData: true, voicemailAudioMimeType: true },
    });
    if (!campaign?.voicemailAudioData || !campaign.voicemailAudioMimeType) {
      return reply.code(404).send({ error: "Voicemail recording not found" });
    }
    const audio = Buffer.from(campaign.voicemailAudioData, "base64");
    reply.header("content-type", campaign.voicemailAudioMimeType);
    reply.header("cache-control", "private, max-age=60");
    return reply.send(audio);
  });

  app.get("/campaigns/:id/voice-instructions", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const query = req.query as { contactId?: string; t?: string };
    if (!req.auth?.sub && !verifyCampaignMediaToken(id, query.t)) {
      return reply.code(403).send({ error: "Forbidden" });
    }
    const campaign = await prisma.campaign.findUnique({
      where: { id },
      select: {
        id: true,
        voiceMessage: true,
        voicemailDropEnabled: true,
        voicemailMessage: true,
        voicemailAudioData: true,
        voicemailAudioMimeType: true,
      },
    });
    if (!campaign) return reply.code(404).send({ error: "Not found" });

    const base = publicBaseUrl(req);
    const audioUrl =
      campaign.voicemailAudioData && campaign.voicemailAudioMimeType
        ? `${base}/campaigns/${campaign.id}/voicemail-recording?t=${campaignMediaToken(campaign.id)}`
        : null;

    return {
      campaignId: campaign.id,
      contactId: query.contactId ?? null,
      liveAnswer: {
        mode: "say",
        text: campaign.voiceMessage,
      },
      voicemailDrop: {
        enabled: campaign.voicemailDropEnabled,
        mode: audioUrl ? "play" : campaign.voicemailMessage?.trim() ? "say" : "none",
        text: campaign.voicemailMessage ?? null,
        audioUrl,
        audioMimeType: campaign.voicemailAudioMimeType ?? null,
      },
    };
  });

  app.delete("/campaigns/:id", async (req, reply) => {
    if (!(await enforceFunctionAccess(req as { auth: { sub: string; role: "user" | "admin" | "owner" } | null }, reply, "campaign_delete"))) {
      return;
    }
    const id = (req.params as { id: string }).id;
    const auth = await requireCampaignAccess(req, reply, id);
    if (!auth) return;
    await prisma.campaign.delete({ where: { id } });
    await writeAuditLog({
      organizationId: auth.orgId,
      actorUserId: auth.sub,
      action: "campaign.deleted",
      entityType: "Campaign",
      entityId: id,
    });
    return { ok: true };
  });

  app.post("/campaigns/:id/contacts", async (req, reply) => {
    if (!(await enforceFunctionAccess(req as { auth: { sub: string; role: "user" | "admin" | "owner" } | null }, reply, "contact_import"))) {
      return;
    }
    const id = (req.params as { id: string }).id;
    const campaign = await prisma.campaign.findUnique({ where: { id }, select: { id: true } });
    if (!campaign) return reply.code(404).send({ error: "Campaign not found" });

    const contentType = req.headers["content-type"] ?? "";
    let rows: { phone: string; name?: string; metadata?: Record<string, unknown> }[] = [];

    if (contentType.includes("multipart/form-data")) {
      const mp = await req.file();
      if (!mp) return reply.code(400).send({ error: "Expected file field" });
      const buf = await mp.toBuffer();
      const text = buf.toString("utf8");
      const records = parse(text, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      }) as Record<string, string>[];
      for (const r of records) {
        const phone = r.phone ?? r.Phone ?? r.PHONE ?? r.mobile ?? r.Mobile ?? "";
        const name = r.name ?? r.Name ?? r.full_name;
        if (phone) rows.push({ phone, name, metadata: r });
      }
    } else {
      const parsed = contactsJsonSchema.parse(req.body);
      rows = parsed.rows;
    }

    const importAuth = await requireCampaignAccess(req, reply, id);
    if (!importAuth) return;
    const dnc = new Set(
      (
        await prisma.dncEntry.findMany({
          where: { organizationId: importAuth.orgId },
          select: { e164: true },
        })
      ).map((x) => x.e164),
    );

    const existingPhones = new Set(
      (
        await prisma.contact.findMany({
          where: { campaignId: id },
          select: { phoneE164: true },
        })
      ).map((c) => c.phoneE164),
    );

    let skipped = 0;
    let skippedInvalidPhone = 0;
    let skippedDuplicate = 0;
    let skippedDnc = 0;
    const invalidPhoneExamples: string[] = [];
    const duplicateExamples: string[] = [];
    const skippedRows: { phone: string; reason: string }[] = [];
    const seenInBatch = new Set<string>();
    const toInsert: Prisma.ContactCreateManyInput[] = [];

    const pushSkipped = (phone: string, reason: string) => {
      skipped++;
      if (skippedRows.length < 100) skippedRows.push({ phone, reason });
    };

    for (const r of rows) {
      const e164 = toE164(r.phone);
      if (!e164) {
        skippedInvalidPhone++;
        pushSkipped(r.phone, "invalid_phone");
        if (invalidPhoneExamples.length < 5) invalidPhoneExamples.push(r.phone);
        continue;
      }
      if (dnc.has(e164)) {
        skippedDnc++;
        pushSkipped(e164, "dnc");
        continue;
      }
      if (existingPhones.has(e164) || seenInBatch.has(e164)) {
        skippedDuplicate++;
        pushSkipped(e164, "duplicate");
        if (duplicateExamples.length < 5) duplicateExamples.push(e164);
        continue;
      }
      seenInBatch.add(e164);
      toInsert.push({
        campaignId: id,
        phoneE164: e164,
        name: r.name,
        metadata: r.metadata === undefined ? undefined : (r.metadata as Prisma.InputJsonValue),
      });
    }
    // One batched insert instead of a round-trip per row.
    const insertResult = toInsert.length ? await prisma.contact.createMany({ data: toInsert }) : { count: 0 };
    const created = insertResult.count;

    return {
      created,
      skipped,
      skippedInvalidPhone,
      skippedDuplicate,
      skippedDnc,
      duplicateExamples,
      invalidPhoneExamples,
      skippedRows,
      importRule:
        "phone should include country code (e.g. +12025550101). US 10-digit numbers are also accepted.",
    };
  });

  app.post("/campaigns/:id/start", async (req, reply) => {
    if (!(await enforceFunctionAccess(req as { auth: { sub: string; role: "user" | "admin" | "owner" } | null }, reply, "campaign_start"))) {
      return;
    }
    const id = (req.params as { id: string }).id;
    const c = await prisma.campaign.findUnique({
      where: { id },
      select: { kind: true, consentAttestedAt: true, smsTemplate: true },
    });
    if (!c) return reply.code(404).send({ error: "Not found" });
    if (!c.consentAttestedAt) {
      return reply.code(400).send({ error: "Consent not recorded for this campaign" });
    }

    if (c.kind === "SMS") {
      const parsed = smsStartBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid start payload" });
      }
      const body = (parsed.data.body ?? c.smsTemplate ?? "").trim();
      if (!body) {
        return reply.code(400).send({
          error: "SMS message is missing. Edit the message on this campaign, then press Start SMS.",
        });
      }
      let pendingCount = await prisma.contact.count({
        where: { campaignId: id, status: "PENDING" },
      });
      if (pendingCount === 0) {
        const total = await prisma.contact.count({ where: { campaignId: id } });
        if (total === 0) {
          return reply.code(400).send({
            error:
              "No contacts to text. Upload a CSV once when creating the campaign, or add contacts if the list is empty.",
          });
        }
        // Start again: recycle the existing list without requiring another CSV upload.
        await prisma.contact.updateMany({
          where: { campaignId: id },
          data: { status: "PENDING" },
        });
        pendingCount = total;
      }
      const orgAuth = await requireCampaignAccess(req, reply, id);
      if (!orgAuth) return;
      const { smsPerMinute, spacingMs } = await resolveSmsPerMinute(
        orgAuth.orgId,
        parsed.data.smsPerMinute,
      );
      if (parsed.data.smsPerMinute !== undefined) {
        await upsertOrgSmsPerMinute(orgAuth.orgId, smsPerMinute);
      }
      await prisma.campaign.update({
        where: { id },
        data: {
          status: "RUNNING",
          startedByUserId: orgAuth.sub,
          smsTemplate: body,
        },
      });
      await writeAuditLog({
        organizationId: orgAuth.orgId,
        actorUserId: orgAuth.sub,
        action: "campaign.start",
        entityType: "Campaign",
        entityId: id,
      });
      // Progressive send: one message per tick at the configured rate (survives large lists).
      await enqueueSmsCampaignTick(id, 0);
      return {
        ok: true,
        status: "RUNNING",
        kind: "SMS",
        queued: pendingCount,
        smsPerMinute,
        spacingMs,
      };
    }

    const pending = await prisma.contact.count({ where: { campaignId: id, status: "PENDING" } });
    if (pending === 0) {
      return reply.code(400).send({ error: "No pending contacts to dial" });
    }
    const auth = (req as { auth: { sub: string } | null }).auth;
    await prisma.campaign.update({
      where: { id },
      data: { status: "RUNNING", startedByUserId: auth?.sub ?? undefined },
    });
    if (!(await usesZoomPhoneAgentDial())) {
      await enqueueDialNext(id);
    }
    return {
      ok: true,
      status: "RUNNING",
      kind: "DIAL",
      agentDialMode: await usesZoomPhoneAgentDial(),
    };
  });

  app.post("/campaigns/:id/pause", async (req, reply) => {
    if (!(await enforceFunctionAccess(req as { auth: { sub: string; role: "user" | "admin" | "owner" } | null }, reply, "campaign_pause"))) {
      return;
    }
    const id = (req.params as { id: string }).id;
    const c = await prisma.campaign.findUnique({ where: { id }, select: { kind: true } });
    if (!c) return reply.code(404).send({ error: "Not found" });
    await prisma.campaign.update({ where: { id }, data: { status: "PAUSED" } });
    return { ok: true, status: "PAUSED" };
  });

  app.post("/campaigns/:id/resume", async (req, reply) => {
    if (!(await enforceFunctionAccess(req as { auth: { sub: string; role: "user" | "admin" | "owner" } | null }, reply, "campaign_resume"))) {
      return;
    }
    const id = (req.params as { id: string }).id;
    const c = await prisma.campaign.findUnique({
      where: { id },
      select: { kind: true, consentAttestedAt: true },
    });
    if (!c) return reply.code(404).send({ error: "Not found" });
    if (!c.consentAttestedAt) {
      return reply.code(400).send({ error: "Consent not recorded for this campaign" });
    }
    if (c.kind === "SMS") {
      const parsed = smsStartBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid resume payload" });
      }
      let pending = await prisma.contact.count({ where: { campaignId: id, status: "PENDING" } });
      if (pending === 0) {
        // Older buggy runs marked everyone DIALED before texts actually sent.
        // Reclaim contacts that never got a successful/queued SMS attempt.
        const unsent = await prisma.contact.findMany({
          where: {
            campaignId: id,
            status: { in: ["DIALED", "DIALING", "SKIPPED"] },
            smsAttempts: { none: { status: { in: ["QUEUED", "SENT", "DELIVERED"] } } },
          },
          select: { id: true },
        });
        if (unsent.length > 0) {
          await prisma.contact.updateMany({
            where: { id: { in: unsent.map((row) => row.id) } },
            data: { status: "PENDING" },
          });
          pending = unsent.length;
        }
      }
      if (pending === 0) {
        return reply.code(400).send({
          error:
            "No contacts left to text. Press Start SMS if you want to send the full list again.",
        });
      }
      const resumeAuth = await requireCampaignAccess(req, reply, id);
      if (!resumeAuth) return;
      if (parsed.data.smsPerMinute !== undefined) {
        const { smsPerMinute } = await resolveSmsPerMinute(
          resumeAuth.orgId,
          parsed.data.smsPerMinute,
        );
        await upsertOrgSmsPerMinute(resumeAuth.orgId, smsPerMinute);
      }
      const nextTemplate = parsed.data.body?.trim();
      await prisma.campaign.update({
        where: { id },
        data: {
          status: "RUNNING",
          startedByUserId: resumeAuth.sub,
          ...(nextTemplate ? { smsTemplate: nextTemplate } : {}),
        },
      });
      await writeAuditLog({
        organizationId: resumeAuth.orgId,
        actorUserId: resumeAuth.sub,
        action: "campaign.resume",
        entityType: "Campaign",
        entityId: id,
      });
      await enqueueSmsCampaignTick(id, 0);
      return {
        ok: true,
        status: "RUNNING",
        kind: "SMS",
        queued: pending,
        smsTemplateUpdated: Boolean(nextTemplate),
      };
    }
    const pending = await prisma.contact.count({ where: { campaignId: id, status: "PENDING" } });
    if (pending === 0) {
      return reply.code(400).send({ error: "No pending contacts to dial" });
    }
    const auth = (req as { auth: { sub: string } | null }).auth;
    await prisma.campaign.update({
      where: { id },
      data: { status: "RUNNING", startedByUserId: auth?.sub ?? undefined },
    });
    if (!(await usesZoomPhoneAgentDial())) {
      await enqueueDialNext(id);
    }
    return {
      ok: true,
      status: "RUNNING",
      kind: "DIAL",
      agentDialMode: await usesZoomPhoneAgentDial(),
    };
  });

  app.post("/campaigns/:id/sms-template", async (req, reply) => {
    if (!(await enforceFunctionAccess(req as { auth: { sub: string; role: "user" | "admin" | "owner" } | null }, reply, "campaign_start"))) {
      return;
    }
    const id = (req.params as { id: string }).id;
    const parsed = z
      .object({ body: z.string().min(1).max(1600) })
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Message is required" });
    }
    const c = await prisma.campaign.findUnique({
      where: { id },
      select: { id: true, kind: true },
    });
    if (!c) return reply.code(404).send({ error: "Not found" });
    if (c.kind !== "SMS") {
      return reply.code(400).send({ error: "SMS template save applies to SMS campaigns only." });
    }
    const body = parsed.data.body.trim();
    const updated = await prisma.campaign.update({
      where: { id },
      data: { smsTemplate: body },
      select: { id: true, smsTemplate: true, status: true },
    });
    return {
      ok: true,
      id: updated.id,
      smsTemplate: updated.smsTemplate,
      status: updated.status,
    };
  });

  app.post("/campaigns/:id/agent-disposition", async (req, reply) => {
    if (
      !(await enforceFunctionAccess(
        req as { auth: { sub: string; role: "user" | "admin" | "owner" } | null },
        reply,
        "campaign_start",
      ))
    ) {
      return;
    }
    if (!(await usesZoomPhoneAgentDial())) {
      return reply.code(400).send({
        error: "Agent disposition is only used when Zoom Phone is the preferred integration.",
      });
    }
    const id = (req.params as { id: string }).id;
    const body = agentDispositionSchema.parse(req.body);
    const campaign = await prisma.campaign.findUnique({
      where: { id },
      select: { kind: true, status: true, fromPhone: true },
    });
    if (!campaign) return reply.code(404).send({ error: "Not found" });
    if (campaign.kind === "SMS") {
      return reply.code(400).send({ error: "Not a voice campaign" });
    }
    if (campaign.status !== "RUNNING") {
      return reply.code(400).send({ error: "Start the dialing session before logging outcomes." });
    }
    const contact = await prisma.contact.findFirst({
      where: { id: body.contactId, campaignId: id },
    });
    if (!contact) return reply.code(404).send({ error: "Contact not found" });

    const disposition = body.disposition as CallDisposition;
    const idempotencyKey = `agent:${contact.id}:${Date.now()}`;
    await prisma.callAttempt.create({
      data: {
        campaignId: id,
        contactId: contact.id,
        idempotencyKey,
        disposition,
        externalCallId: `zoom-agent:${contact.id}`,
        rawPayload: { source: "zoom_phone_agent", disposition: body.disposition } as object,
      },
    });
    await prisma.contact.update({
      where: { id: contact.id },
      data: { status: "DIALED" },
    });

    const pending = await prisma.contact.count({ where: { campaignId: id, status: "PENDING" } });
    if (pending === 0) {
      await prisma.campaign.update({ where: { id }, data: { status: "COMPLETED" } });
    }

    const next = await prisma.contact.findFirst({
      where: { campaignId: id, status: "PENDING" },
      orderBy: { createdAt: "asc" },
    });

    return reply.send({
      ok: true,
      campaignStatus: pending === 0 ? "COMPLETED" : "RUNNING",
      nextContact: next
        ? {
            id: next.id,
            phoneE164: next.phoneE164,
            name: next.name,
            zoomCallUrl: buildZoomPhoneCallUrl(next.phoneE164, campaign.fromPhone),
          }
        : null,
    });
  });

  app.post("/campaigns/:id/agent-skip", async (req, reply) => {
    if (
      !(await enforceFunctionAccess(
        req as { auth: { sub: string; role: "user" | "admin" | "owner" } | null },
        reply,
        "campaign_start",
      ))
    ) {
      return;
    }
    if (!(await usesZoomPhoneAgentDial())) {
      return reply.code(400).send({
        error: "Agent skip is only used when Zoom Phone is the preferred integration.",
      });
    }
    const id = (req.params as { id: string }).id;
    const body = agentSkipSchema.parse(req.body);
    const campaign = await prisma.campaign.findUnique({
      where: { id },
      select: { status: true, fromPhone: true },
    });
    if (!campaign) return reply.code(404).send({ error: "Not found" });
    if (campaign.status !== "RUNNING") {
      return reply.code(400).send({ error: "Start the dialing session before skipping contacts." });
    }
    const contact = await prisma.contact.findFirst({
      where: { id: body.contactId, campaignId: id },
    });
    if (!contact) return reply.code(404).send({ error: "Contact not found" });
    await prisma.contact.update({
      where: { id: contact.id },
      data: { status: "SKIPPED" },
    });
    const pending = await prisma.contact.count({ where: { campaignId: id, status: "PENDING" } });
    if (pending === 0) {
      await prisma.campaign.update({ where: { id }, data: { status: "COMPLETED" } });
    }
    const next = await prisma.contact.findFirst({
      where: { campaignId: id, status: "PENDING" },
      orderBy: { createdAt: "asc" },
    });
    return reply.send({
      ok: true,
      campaignStatus: pending === 0 ? "COMPLETED" : "RUNNING",
      nextContact: next
        ? {
            id: next.id,
            phoneE164: next.phoneE164,
            name: next.name,
            zoomCallUrl: buildZoomPhoneCallUrl(next.phoneE164, campaign.fromPhone),
          }
        : null,
    });
  });

  app.post("/campaigns/:id/sms", async (req, reply) => {
    if (!(await enforceFunctionAccess(req as { auth: { sub: string; role: "user" | "admin" | "owner" } | null }, reply, "sms_broadcast"))) {
      return;
    }
    const id = (req.params as { id: string }).id;
    const auth = await requireCampaignAccess(req, reply, id);
    if (!auth) return;
    const parsed = smsBodySchema.parse(req.body);

    const where =
      parsed.contactIds && parsed.contactIds.length > 0
        ? { id: { in: parsed.contactIds }, campaignId: id }
        : { campaignId: id };

    const contacts = await prisma.contact.findMany({ where, select: { id: true } });
    const { smsPerMinute, spacingMs } = await resolveSmsPerMinute(auth.orgId, parsed.smsPerMinute);
    const jobs = await enqueueCampaignSmsJobs({
      campaignId: id,
      contactIds: contacts.map((row) => row.id),
      body: parsed.body,
      smsPerMinute,
      spacingMs,
    });
    return { queued: jobs.length, smsPerMinute, spacingMs };
  });

  app.patch("/campaigns/:id/contacts/:contactId/notes", async (req, reply) => {
    if (!(await enforceFunctionAccess(req as { auth: { sub: string; role: "user" | "admin" | "owner" } | null }, reply, "campaign_notes"))) {
      return;
    }
    const { id, contactId } = req.params as { id: string; contactId: string };
    const auth = await requireCampaignAccess(req, reply, id);
    if (!auth) return;
    const body = z.object({ notes: z.string().max(4000) }).parse(req.body);
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, campaignId: id },
      select: { id: true },
    });
    if (!contact) return reply.code(404).send({ error: "Contact not found" });
    const updated = await prisma.contact.update({
      where: { id: contactId },
      data: { notes: body.notes },
      select: { id: true, notes: true },
    });
    return updated;
  });

  app.get("/campaigns/:id/attempts", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const auth = await requireCampaignAccess(req, reply, id);
    if (!auth) return;
    const [calls, sms] = await Promise.all([
      prisma.callAttempt.findMany({
        where: { campaignId: id },
        orderBy: { createdAt: "desc" },
        take: 200,
        select: {
          id: true,
          disposition: true,
          createdAt: true,
          contact: { select: { phoneE164: true, name: true } },
        },
      }),
      prisma.smsAttempt.findMany({
        where: { campaignId: id },
        orderBy: { createdAt: "desc" },
        take: 200,
        select: {
          id: true,
          status: true,
          createdAt: true,
          // Needed so the UI can relabel DUPLICATE_WITHIN_WINDOW as skipped (not failed).
          rawPayload: true,
          contact: { select: { phoneE164: true, name: true } },
        },
      }),
    ]);
    return { calls, sms };
  });
}
