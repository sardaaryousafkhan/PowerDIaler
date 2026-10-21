import type { BridgeVoiceCallback } from "@powerdialer/shared";

export function mapZoomEventToDisposition(
  event: string,
  payload: Record<string, unknown>,
): BridgeVoiceCallback["disposition"] {
  const reason = String(payload.result ?? payload.call_result ?? payload.reason ?? "").toLowerCase();
  const duration = Number(payload.duration ?? payload.call_duration ?? 0);

  switch (event) {
    case "phone.call_ringing":
      return "RINGING";
    case "phone.call_answered":
      return "IN_PROGRESS";
    case "phone.call_busy":
      return "BUSY";
    case "phone.call_no_answer":
      return "NO_ANSWER";
    case "phone.call_canceled":
    case "phone.call_cancelled":
      return "CANCELED";
    case "phone.call_fail":
      return "FAILED";
    case "phone.call_completed":
      if (reason.includes("busy")) return "BUSY";
      if (reason.includes("no_answer") || reason.includes("no answer")) return "NO_ANSWER";
      if (duration > 0 || reason.includes("completed") || reason.includes("answered")) {
        return "COMPLETED";
      }
      return "NO_ANSWER";
    default:
      return "UNKNOWN";
  }
}

export function isTerminalDisposition(d: BridgeVoiceCallback["disposition"]): boolean {
  return ["COMPLETED", "BUSY", "NO_ANSWER", "FAILED", "CANCELED"].includes(d);
}
