import { z } from "zod";

export const callDispositionSchema = z.enum([
  "QUEUED",
  "RINGING",
  "IN_PROGRESS",
  "COMPLETED",
  "BUSY",
  "NO_ANSWER",
  "FAILED",
  "CANCELED",
  "UNKNOWN",
]);

export type CallDisposition = z.infer<typeof callDispositionSchema>;

export const smsStatusSchema = z.enum(["QUEUED", "SENT", "DELIVERED", "FAILED", "UNKNOWN"]);

export type SmsStatus = z.infer<typeof smsStatusSchema>;
