import { prisma } from "../db.js";
import { env } from "../env.js";

/** Collapse whitespace so trivial spacing differences still count as the same message. */
export function normalizeSmsBody(body: string): string {
  return body.trim().replace(/\s+/g, " ");
}

/**
 * True if this exact message (normalized) was already queued/sent/delivered
 * to the same phone number within the configured window (default 15 days).
 * Checks across all campaigns.
 */
export async function wasRecentlySentSameSms(input: {
  phoneE164: string;
  body: string;
  organizationId?: string | null;
}): Promise<{ duplicate: true; priorAttemptId: string; sentAt: Date } | { duplicate: false }> {
  const days = env.SMS_DEDUP_DAYS;
  if (days <= 0) return { duplicate: false };

  const normalized = normalizeSmsBody(input.body);
  if (!normalized) return { duplicate: false };

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const orgFilter = input.organizationId
    ? { campaign: { organizationId: input.organizationId } }
    : {};

  // Prefer exact body match (what we store). Also accept normalized equality via a
  // small recent window scan when bodies differ only by whitespace.
  const priorExact = await prisma.smsAttempt.findFirst({
    where: {
      body: normalized,
      createdAt: { gte: since },
      status: { in: ["QUEUED", "SENT", "DELIVERED"] },
      contact: { phoneE164: input.phoneE164 },
      ...orgFilter,
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true },
  });
  if (priorExact) {
    return { duplicate: true, priorAttemptId: priorExact.id, sentAt: priorExact.createdAt };
  }

  // Fallback: same phone, recent successes, body differs only by whitespace.
  const recent = await prisma.smsAttempt.findMany({
    where: {
      createdAt: { gte: since },
      status: { in: ["QUEUED", "SENT", "DELIVERED"] },
      contact: { phoneE164: input.phoneE164 },
      ...orgFilter,
    },
    orderBy: { createdAt: "desc" },
    take: 40,
    select: { id: true, createdAt: true, body: true },
  });
  const match = recent.find((row) => normalizeSmsBody(row.body) === normalized);
  if (match) {
    return { duplicate: true, priorAttemptId: match.id, sentAt: match.createdAt };
  }

  return { duplicate: false };
}
