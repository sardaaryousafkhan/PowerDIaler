import type { BridgeSmsCallback, BridgeVoiceCallback } from "@powerdialer/shared";
import { signCallbackBody } from "../auth/callbackSign.js";
import { prisma } from "../db.js";

const MAX_ATTEMPTS = 6;

async function postCallback(targetUrl: string, body: string, signature: string): Promise<void> {
  const res = await fetch(targetUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-bridge-signature": signature,
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`Callback failed (${res.status})`);
  }
}

export async function enqueueCallback(
  targetUrl: string,
  payload: BridgeVoiceCallback | BridgeSmsCallback,
): Promise<void> {
  const body = JSON.stringify(payload);
  const signature = signCallbackBody(body);
  try {
    await postCallback(targetUrl, body, signature);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.callbackOutbox.create({
      data: {
        targetUrl,
        body,
        signature,
        lastError: msg,
        nextRetryAt: new Date(Date.now() + 2000),
      },
    });
  }
}

export async function processCallbackOutbox(): Promise<void> {
  const due = await prisma.callbackOutbox.findMany({
    where: { deadLetter: false, nextRetryAt: { lte: new Date() } },
    take: 20,
    orderBy: { nextRetryAt: "asc" },
  });
  for (const row of due) {
    try {
      await postCallback(row.targetUrl, row.body, row.signature);
      await prisma.callbackOutbox.delete({ where: { id: row.id } });
    } catch (e) {
      const attempts = row.attempts + 1;
      const msg = e instanceof Error ? e.message : String(e);
      if (attempts >= MAX_ATTEMPTS) {
        console.error("[google-voice-bridge] callback dead-letter", {
          targetUrl: row.targetUrl,
          error: msg,
        });
        await prisma.callbackOutbox.update({
          where: { id: row.id },
          data: { attempts, deadLetter: true, lastError: msg },
        });
      } else {
        const delayMs = Math.min(60_000, 2000 * 2 ** attempts);
        await prisma.callbackOutbox.update({
          where: { id: row.id },
          data: {
            attempts,
            lastError: msg,
            nextRetryAt: new Date(Date.now() + delayMs),
          },
        });
      }
    }
  }
}
