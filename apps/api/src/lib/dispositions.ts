import type { CallDisposition } from "@prisma/client";

const terminal: ReadonlySet<CallDisposition> = new Set([
  "COMPLETED",
  "BUSY",
  "NO_ANSWER",
  "FAILED",
  "CANCELED",
]);

export function isTerminalCallDisposition(d: CallDisposition): boolean {
  return terminal.has(d);
}
