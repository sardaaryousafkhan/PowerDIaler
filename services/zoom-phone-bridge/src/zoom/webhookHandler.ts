import { createHash } from "node:crypto";
import type { BridgeSmsCallback, BridgeVoiceCallback } from "@powerdialer/shared";
import { prisma } from "../db.js";
import { enqueueCallback } from "./callbacks.js";
import { isTerminalDisposition, mapZoomEventToDisposition } from "./disposition.js";

type ZoomPayload = {
  event?: string;
  payload?: {
    account_id?: string;
    object?: Record<string, unknown>;
  };
};

function callIdFromObject(obj: Record<string, unknown>): string | undefined {
  const id = obj.call_id ?? obj.callId ?? obj.id;
  return id != null ? String(id) : undefined;
}

export async function handleZoomPhoneWebhook(body: ZoomPayload, rawBody?: string): Promise<void> {
  const event = body.event ?? "";
  const obj = body.payload?.object ?? {};
  const callId = callIdFromObject(obj);
  const eventTs = obj.event_ts ?? obj.timestamp;

  // Deterministic dedup. Prefer event_ts when Zoom supplies it; otherwise fall
  // back to sha256(rawBody) so retried events with the same body still dedup.
  let dedupeKey: string | undefined;
  if (callId && eventTs != null) {
    dedupeKey = `${event}:${callId}:${String(eventTs)}`;
  } else if (rawBody) {
    dedupeKey = `${event}:body:${createHash("sha256").update(rawBody).digest("hex")}`;
  } else if (callId) {
    dedupeKey = `${event}:${callId}:no-ts`;
  }
  if (dedupeKey) {
    try {
      await prisma.webhookDedup.create({ data: { dedupeKey } });
    } catch {
      return;
    }
  }

  if (event.startsWith("phone.sms_")) {
    const messageId = String(obj.message_id ?? obj.id ?? "");
    if (!messageId) return;
    const sms = await prisma.bridgeSms.findFirst({ where: { externalMessageId: messageId } });
    if (!sms?.statusCallbackUrl) return;
    let status: BridgeSmsCallback["status"] = "UNKNOWN";
    if (event === "phone.sms_sent") status = "SENT";
    else if (event === "phone.sms_delivered") status = "DELIVERED";
    else if (event === "phone.sms_failed") status = "FAILED";
    await prisma.bridgeSms.update({
      where: { id: sms.id },
      data: { status, terminalAt: status === "DELIVERED" || status === "FAILED" ? new Date() : undefined },
    });
    await enqueueCallback(sms.statusCallbackUrl, {
      externalMessageId: messageId,
      status,
      provider: "zoom_phone",
      raw: obj as Record<string, unknown>,
    });
    return;
  }

  if (!callId || !event.startsWith("phone.call_")) {
    if (event === "phone.recording_completed" && callId) {
      await handleRecordingCompleted(callId, obj);
    }
    return;
  }

  const call = await prisma.bridgeCall.findFirst({ where: { externalCallId: callId } });
  if (!call) return;

  const disposition = mapZoomEventToDisposition(event, obj);
  const terminal = isTerminalDisposition(disposition);

  await prisma.bridgeCall.update({
    where: { id: call.id },
    data: {
      disposition,
      ...(terminal ? { terminalAt: new Date() } : {}),
    },
  });

  const callback: BridgeVoiceCallback = {
    externalCallId: call.externalCallId,
    disposition,
    provider: "zoom_phone",
    campaignId: call.campaignId,
    contactId: call.contactId,
    idempotencyKey: call.idempotencyKey,
    voicemailDropSupported: call.voicemailDropEnabled ? false : undefined,
    raw: obj as Record<string, unknown>,
  };

  if (terminal || disposition === "RINGING" || disposition === "IN_PROGRESS") {
    await enqueueCallback(call.statusCallbackUrl, callback);
  }
}

async function handleRecordingCompleted(callId: string, obj: Record<string, unknown>): Promise<void> {
  const call = await prisma.bridgeCall.findFirst({ where: { externalCallId: callId } });
  if (!call) return;
  const recordingUrl = String(obj.download_url ?? obj.recording_url ?? "");
  if (!recordingUrl) return;
  // Idempotency: skip if we've already stored this exact recording URL.
  if (call.recordingUrl === recordingUrl) return;
  await prisma.bridgeCall.update({
    where: { id: call.id },
    data: { recordingUrl },
  });
  await enqueueCallback(call.statusCallbackUrl, {
    externalCallId: call.externalCallId,
    disposition: (call.disposition as BridgeVoiceCallback["disposition"]) || "COMPLETED",
    provider: "zoom_phone",
    campaignId: call.campaignId,
    contactId: call.contactId,
    idempotencyKey: call.idempotencyKey,
    recordingUrl,
    raw: obj as Record<string, unknown>,
  });
}
