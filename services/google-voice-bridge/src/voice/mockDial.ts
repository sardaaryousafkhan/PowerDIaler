import { randomUUID } from "node:crypto";
import type { BridgeVoiceCallback } from "@powerdialer/shared";
import { prisma } from "../db.js";
import { enqueueCallback } from "./callbacks.js";
import { isTerminalDisposition } from "./disposition.js";

const LIFECYCLE: BridgeVoiceCallback["disposition"][] = ["RINGING", "IN_PROGRESS", "COMPLETED"];

function remainingSteps(current: string): BridgeVoiceCallback["disposition"][] {
  if (current === "QUEUED") return LIFECYCLE;
  const idx = LIFECYCLE.indexOf(current as BridgeVoiceCallback["disposition"]);
  if (idx === -1) return LIFECYCLE;
  return LIFECYCLE.slice(idx + 1);
}

export async function startMockCallLifecycle(callId: string): Promise<void> {
  const call = await prisma.bridgeCall.findUnique({ where: { id: callId } });
  if (!call) return;

  const base: Omit<BridgeVoiceCallback, "disposition"> = {
    externalCallId: call.externalCallId,
    provider: "google_voice",
    campaignId: call.campaignId,
    contactId: call.contactId,
    idempotencyKey: call.idempotencyKey,
    voicemailDropSupported: call.voicemailDropEnabled ? false : undefined,
    raw: { mode: "mock" },
  };

  const steps = remainingSteps(call.disposition);
  for (let i = 0; i < steps.length; i++) {
    await new Promise((r) => setTimeout(r, i === 0 && call.disposition === "QUEUED" ? 800 : 1200));
    const disposition = steps[i]!;
    await prisma.bridgeCall.update({
      where: { id: call.id },
      data: {
        disposition,
        ...(isTerminalDisposition(disposition) ? { terminalAt: new Date() } : {}),
      },
    });
    await enqueueCallback(call.statusCallbackUrl, { ...base, disposition });
    if (isTerminalDisposition(disposition)) break;
  }
}

/** Hybrid mode: ring briefly then time out — agent must dial via tel:/Voice UI manually. */
export async function startHybridCallLifecycle(callId: string, hybridDialUri: string): Promise<void> {
  const call = await prisma.bridgeCall.findUnique({ where: { id: callId } });
  if (!call) return;

  const base: Omit<BridgeVoiceCallback, "disposition"> = {
    externalCallId: call.externalCallId,
    provider: "google_voice",
    campaignId: call.campaignId,
    contactId: call.contactId,
    idempotencyKey: call.idempotencyKey,
    raw: { mode: "hybrid", hybridDialUri },
  };

  await prisma.bridgeCall.update({
    where: { id: call.id },
    data: { disposition: "RINGING" },
  });
  await enqueueCallback(call.statusCallbackUrl, { ...base, disposition: "RINGING" });

  await new Promise((r) => setTimeout(r, 45_000));
  const fresh = await prisma.bridgeCall.findUnique({ where: { id: callId } });
  if (!fresh || fresh.terminalAt) return;

  await prisma.bridgeCall.update({
    where: { id: call.id },
    data: { disposition: "NO_ANSWER", terminalAt: new Date() },
  });
  await enqueueCallback(call.statusCallbackUrl, { ...base, disposition: "NO_ANSWER" });
}

/** CCAI v1: optimistic lifecycle until platform webhooks are wired. */
export async function startCcaiCallLifecycle(callId: string, ccaiSessionId: string): Promise<void> {
  const call = await prisma.bridgeCall.findUnique({ where: { id: callId } });
  if (!call) return;

  const base: Omit<BridgeVoiceCallback, "disposition"> = {
    externalCallId: call.externalCallId,
    provider: "google_voice",
    campaignId: call.campaignId,
    contactId: call.contactId,
    idempotencyKey: call.idempotencyKey,
    raw: { mode: "ccai", ccaiSessionId },
  };

  for (const [i, disposition] of (["RINGING", "IN_PROGRESS", "COMPLETED"] as const).entries()) {
    await new Promise((r) => setTimeout(r, i === 0 ? 500 : 1500));
    const fresh = await prisma.bridgeCall.findUnique({ where: { id: callId } });
    if (!fresh || fresh.terminalAt) return;
    await prisma.bridgeCall.update({
      where: { id: call.id },
      data: {
        disposition,
        ...(isTerminalDisposition(disposition) ? { terminalAt: new Date() } : {}),
      },
    });
    await enqueueCallback(call.statusCallbackUrl, { ...base, disposition });
  }
}

export async function reconcileInFlightMockCalls(): Promise<number> {
  const cutoff = new Date(Date.now() - 30 * 60 * 1000);
  const stuck = await prisma.bridgeCall.findMany({
    where: { terminalAt: null, createdAt: { gte: cutoff } },
    take: 100,
  });
  for (const c of stuck) {
    void startMockCallLifecycle(c.id);
  }
  return stuck.length;
}

export function newExternalCallId(prefix = "gv-mock"): string {
  return `${prefix}-${randomUUID()}`;
}

export function hybridDialUri(toE164: string): string {
  const digits = toE164.replace(/[^\d+]/g, "");
  return `tel:${digits}`;
}

export function voiceWebUri(toE164: string): string {
  const digits = toE164.replace(/\D/g, "");
  return `https://voice.google.com/calls?a=nc&number=${encodeURIComponent("+" + digits.replace(/^\+/, ""))}`;
}
