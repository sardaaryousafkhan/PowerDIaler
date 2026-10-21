import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { env } from "../env.js";
import { prisma } from "../db.js";

function masterKey(): Buffer {
  const raw = env.SECRETS_MASTER_KEY || env.AUTH_SECRET;
  return createHash("sha256").update(raw).digest();
}

/** Encrypt a secret for per-org storage (AES-256-GCM). */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptSecret(ciphertextB64: string): string {
  const buf = Buffer.from(ciphertextB64, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

/** Persist an encrypted secret for an organization (e.g. TWILIO_AUTH_TOKEN). */
export async function setOrgSecret(organizationId: string, key: string, plaintext: string): Promise<void> {
  const ciphertext = encryptSecret(plaintext);
  await prisma.organizationSecret.upsert({
    where: { organizationId_key: { organizationId, key } },
    create: { organizationId, key, ciphertext },
    update: { ciphertext },
  });
}

export async function getOrgSecret(organizationId: string, key: string): Promise<string | null> {
  const row = await prisma.organizationSecret.findUnique({
    where: { organizationId_key: { organizationId, key } },
  });
  if (!row) return null;
  try {
    return decryptSecret(row.ciphertext);
  } catch {
    return null;
  }
}

/** Prefer org-encrypted secret; fall back to process env for demo/single-tenant. */
export async function resolveSecret(
  organizationId: string | null | undefined,
  key: string,
): Promise<string | undefined> {
  if (organizationId) {
    const fromOrg = await getOrgSecret(organizationId, key);
    if (fromOrg) return fromOrg;
  }
  const fromEnv = (env as Record<string, unknown>)[key];
  return typeof fromEnv === "string" && fromEnv.trim() ? fromEnv : undefined;
}
