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
    provider: "zoom_phone",
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

/**
 * Reconciles in-flight mock calls after a bridge restart. Finds any BridgeCall
 * with no terminalAt that's recent enough to be a real in-flight call (not stale
 * forever), and resumes its lifecycle from the current disposition.
 */
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

export function newExternalCallId(): string {
  return `mock-${randomUUID()}`;
}
