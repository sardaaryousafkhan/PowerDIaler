import { prisma } from "../db.js";

const TERMINAL_TTL_MS = 30 * 60 * 1000;

export async function cleanupExpiredRecords(): Promise<void> {
  const cutoff = new Date(Date.now() - TERMINAL_TTL_MS);
  await prisma.bridgeCall.deleteMany({
    where: { terminalAt: { not: null, lt: cutoff } },
  });
  await prisma.bridgeSms.deleteMany({
    where: { terminalAt: { not: null, lt: cutoff } },
  });
  await prisma.webhookDedup.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
  });
}
