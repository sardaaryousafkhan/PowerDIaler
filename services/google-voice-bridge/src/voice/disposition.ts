import type { BridgeVoiceCallback } from "@powerdialer/shared";

export function isTerminalDisposition(d: BridgeVoiceCallback["disposition"]): boolean {
  return ["COMPLETED", "BUSY", "NO_ANSWER", "FAILED", "CANCELED"].includes(d);
}
