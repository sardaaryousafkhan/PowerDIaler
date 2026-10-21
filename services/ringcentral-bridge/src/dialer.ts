import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import type { BridgeSmsCallback, BridgeVoiceCallback } from "@powerdialer/shared";
import { env } from "./env.js";
import { signCallbackBody } from "./auth.js";
import { createRingOut, getRingOut, sendSms } from "./rcApi.js";

const execFileAsync = promisify(execFile);

type CallRecord = {
  externalCallId: string;
  statusCallbackUrl: string;
  campaignId?: string;
  contactId?: string;
  idempotencyKey: string;
  terminal: boolean;
};

type SmsRecord = {
  externalMessageId: string;
  statusCallbackUrl?: string;
  idempotencyKey: string;
};

const callsByIdempotency = new Map<string, CallRecord>();
const smsByIdempotency = new Map<string, SmsRecord>();

function digitsForUri(toE164: string): string {
  return toE164.replace(/\D/g, "");
}

/** RingCentral desktop deep link (macOS / Windows RC app). */
export function ringcentralCallUri(toE164: string): string {
  return `rcapp://r/call?number=${digitsForUri(toE164)}`;
}

export function ringcentralSmsUri(toE164: string, body?: string): string {
  const number = digitsForUri(toE164);
  const params = new URLSearchParams({ type: "new", number });
  if (body?.trim()) params.set("content", body.trim().slice(0, 1000));
  return `rcapp://r/sms?${params.toString()}`;
}

async function openUri(uri: string): Promise<void> {
  if (process.platform === "darwin") {
    await execFileAsync("open", [uri]);
    return;
  }
  if (process.platform === "win32") {
    await execFileAsync("cmd", ["/c", "start", "", uri]);
    return;
  }
  await execFileAsync("xdg-open", [uri]);
}

async function postCallback(
  targetUrl: string,
  payload: BridgeVoiceCallback | BridgeSmsCallback,
): Promise<void> {
  const body = JSON.stringify(payload);
  const signature = signCallbackBody(body);
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

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

function mapRingOutDisposition(
  status?: { callStatus?: string; calleeStatus?: string },
): BridgeVoiceCallback["disposition"] | null {
  const call = (status?.callStatus ?? "").toLowerCase();
  const callee = (status?.calleeStatus ?? "").toLowerCase();
  if (call === "success" || callee === "finished" || callee === "success") {
    return "COMPLETED";
  }
  if (callee === "noanswer" || call === "cannotreach") {
    return "NO_ANSWER";
  }
  if (callee === "busy" || call === "busy") {
    return "NO_ANSWER";
  }
  if (call === "error" || callee === "error" || callee === "rejected") {
    return "FAILED";
  }
  if (callee === "inprogress" || call === "inprogress") {
    return "IN_PROGRESS";
  }
  if (callee === "ringing" || call === "inprogress" || !call) {
    return "RINGING";
  }
  return null;
}

async function runApiVoiceLifecycle(call: CallRecord): Promise<void> {
  const base: Omit<BridgeVoiceCallback, "disposition"> = {
    externalCallId: call.externalCallId,
    provider: "ringcentral",
    campaignId: call.campaignId,
    contactId: call.contactId,
    idempotencyKey: call.idempotencyKey,
    raw: { mode: "api" },
  };

  let last: BridgeVoiceCallback["disposition"] | null = null;
  const started = Date.now();
  const maxMs = 120_000;

  while (!call.terminal && Date.now() - started < maxMs) {
    try {
      const snap = await getRingOut(call.externalCallId);
      const disposition = mapRingOutDisposition(snap.status) ?? "RINGING";
      if (disposition !== last) {
        last = disposition;
        await postCallback(call.statusCallbackUrl, {
          ...base,
          disposition,
          raw: { mode: "api", ringOut: snap },
        });
        if (
          disposition === "COMPLETED" ||
          disposition === "FAILED" ||
          disposition === "NO_ANSWER"
        ) {
          call.terminal = true;
          return;
        }
      }
    } catch (e) {
      console.error("[ringcentral-bridge] ring-out poll error", e);
    }
    await sleep(2000);
  }

  if (!call.terminal) {
    try {
      await postCallback(call.statusCallbackUrl, {
        ...base,
        disposition: "COMPLETED",
        raw: { mode: "api", note: "poll timeout" },
      });
    } catch (e) {
      console.error("[ringcentral-bridge] voice callback error", e);
    }
    call.terminal = true;
  }
}

async function runVoiceLifecycle(
  call: CallRecord,
  mode: "uri" | "mock",
  dialUri?: string,
): Promise<void> {
  const base: Omit<BridgeVoiceCallback, "disposition"> = {
    externalCallId: call.externalCallId,
    provider: "ringcentral",
    campaignId: call.campaignId,
    contactId: call.contactId,
    idempotencyKey: call.idempotencyKey,
    raw: { mode, dialUri },
  };

  const steps: BridgeVoiceCallback["disposition"][] =
    mode === "mock"
      ? ["RINGING", "IN_PROGRESS", "COMPLETED"]
      : ["RINGING", "IN_PROGRESS", "COMPLETED"];

  for (let i = 0; i < steps.length; i++) {
    if (call.terminal) return;
    const disposition = steps[i]!;
    if (i === 0) await sleep(mode === "mock" ? 600 : 800);
    else if (disposition === "IN_PROGRESS") await sleep(mode === "mock" ? 1000 : 1500);
    else if (disposition === "COMPLETED") {
      await sleep(mode === "mock" ? 1200 : env.URI_CALL_HOLD_MS);
    }
    if (call.terminal) return;
    try {
      await postCallback(call.statusCallbackUrl, { ...base, disposition });
    } catch (e) {
      console.error("[ringcentral-bridge] voice callback error", e);
    }
    if (disposition === "COMPLETED" || disposition === "FAILED" || disposition === "NO_ANSWER") {
      call.terminal = true;
    }
  }
}

export async function placeCall(input: {
  toE164: string;
  fromE164?: string;
  campaignId: string;
  contactId: string;
  idempotencyKey: string;
  statusCallbackUrl: string;
}): Promise<{ externalCallId: string; dialUri?: string; duplicate?: boolean }> {
  const existing = callsByIdempotency.get(input.idempotencyKey);
  if (existing) {
    return { externalCallId: existing.externalCallId, duplicate: true };
  }

  const mode = env.RINGCENTRAL_BRIDGE_MODE;

  if (mode === "api") {
    const fromE164 = input.fromE164 || env.RC_DEFAULT_FROM;
    if (!fromE164) {
      throw new Error("fromE164 or RC_DEFAULT_FROM required for API mode");
    }
    const ringOut = await createRingOut({ fromE164, toE164: input.toE164 });
    const call: CallRecord = {
      externalCallId: String(ringOut.id),
      statusCallbackUrl: input.statusCallbackUrl,
      campaignId: input.campaignId,
      contactId: input.contactId,
      idempotencyKey: input.idempotencyKey,
      terminal: false,
    };
    callsByIdempotency.set(input.idempotencyKey, call);
    console.log(`[ringcentral-bridge] RingOut ${ringOut.id} to ${input.toE164}`);
    void runApiVoiceLifecycle(call);
    return { externalCallId: call.externalCallId };
  }

  const externalCallId = `rc-${mode}-${randomUUID()}`;
  const dialUri = ringcentralCallUri(input.toE164);
  const call: CallRecord = {
    externalCallId,
    statusCallbackUrl: input.statusCallbackUrl,
    campaignId: input.campaignId,
    contactId: input.contactId,
    idempotencyKey: input.idempotencyKey,
    terminal: false,
  };
  callsByIdempotency.set(input.idempotencyKey, call);

  if (mode === "uri") {
    try {
      await openUri(dialUri);
      console.log(`[ringcentral-bridge] opened ${dialUri}`);
    } catch (e) {
      console.error("[ringcentral-bridge] failed to open RingCentral URI", e);
      // Still run lifecycle so the dialer does not stall forever.
    }
  }

  void runVoiceLifecycle(call, mode, mode === "uri" ? dialUri : undefined);
  return { externalCallId, dialUri: mode === "uri" ? dialUri : undefined };
}

export async function placeSms(input: {
  toE164: string;
  fromE164?: string;
  body: string;
  idempotencyKey: string;
  statusCallbackUrl?: string;
}): Promise<{ externalMessageId: string; smsUri?: string; duplicate?: boolean }> {
  const existing = smsByIdempotency.get(input.idempotencyKey);
  if (existing) {
    return { externalMessageId: existing.externalMessageId, duplicate: true };
  }

  const mode = env.RINGCENTRAL_BRIDGE_MODE;

  if (mode === "api") {
    const fromE164 = input.fromE164 || env.RC_DEFAULT_FROM;
    if (!fromE164) {
      throw new Error("fromE164 or RC_DEFAULT_FROM required for API mode");
    }
    const sms = await sendSms({
      fromE164,
      toE164: input.toE164,
      text: input.body,
    });
    const externalMessageId = String(sms.id);
    smsByIdempotency.set(input.idempotencyKey, {
      externalMessageId,
      statusCallbackUrl: input.statusCallbackUrl,
      idempotencyKey: input.idempotencyKey,
    });
    console.log(`[ringcentral-bridge] SMS ${externalMessageId} to ${input.toE164}`);
    if (input.statusCallbackUrl) {
      const payload: BridgeSmsCallback = {
        externalMessageId,
        status: "QUEUED",
        provider: "ringcentral",
        raw: { mode: "api", sms },
      };
      void (async () => {
        try {
          await postCallback(input.statusCallbackUrl!, payload);
          await sleep(800);
          await postCallback(input.statusCallbackUrl!, {
            ...payload,
            status: sms.messageStatus === "DeliveryFailed" ? "FAILED" : "DELIVERED",
            raw: { mode: "api", sms },
          });
        } catch (e) {
          console.error("[ringcentral-bridge] sms callback error", e);
        }
      })();
    }
    return { externalMessageId };
  }

  const externalMessageId = `rc-sms-${mode}-${randomUUID()}`;
  const smsUri = ringcentralSmsUri(input.toE164, input.body);
  smsByIdempotency.set(input.idempotencyKey, {
    externalMessageId,
    statusCallbackUrl: input.statusCallbackUrl,
    idempotencyKey: input.idempotencyKey,
  });

  if (mode === "uri") {
    try {
      await openUri(smsUri);
      console.log(`[ringcentral-bridge] opened SMS ${smsUri}`);
    } catch (e) {
      console.error("[ringcentral-bridge] failed to open RingCentral SMS URI", e);
    }
  }

  if (input.statusCallbackUrl) {
    const payload: BridgeSmsCallback = {
      externalMessageId,
      status: "QUEUED",
      provider: "ringcentral",
      raw: { mode, smsUri, preview: input.body.slice(0, 40) },
    };
    void (async () => {
      try {
        await postCallback(input.statusCallbackUrl!, payload);
        await sleep(800);
        await postCallback(input.statusCallbackUrl!, {
          ...payload,
          status: "DELIVERED",
        });
      } catch (e) {
        console.error("[ringcentral-bridge] sms callback error", e);
      }
    })();
  }

  return { externalMessageId, smsUri: mode === "uri" ? smsUri : undefined };
}
