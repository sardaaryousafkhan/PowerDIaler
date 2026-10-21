import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

/**
 * SQLite tuning: WAL lets the UI keep reading while the dialer writes
 * (the default journal mode blocks readers during every write), and the busy
 * timeout retries instead of throwing "database is locked" under load.
 */
void prisma
  .$queryRawUnsafe("PRAGMA journal_mode=WAL;")
  .then(() => prisma.$queryRawUnsafe("PRAGMA busy_timeout=5000;"))
  .then(() => prisma.$queryRawUnsafe("PRAGMA synchronous=NORMAL;"))
  .catch(() => {});
