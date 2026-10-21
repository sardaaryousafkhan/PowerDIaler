import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { env } from "./env.js";
import type { OrgRolePublic } from "@powerdialer/shared";

export type AuthRole = "user" | "admin" | "owner";

export type AuthClaims = {
  sub: string;
  role: AuthRole;
  email: string;
  name: string;
  orgId: string | null;
  orgRole: OrgRolePublic | null;
  membershipId: string | null;
  tokenVersion: number;
  iat: number;
  exp: number;
};

const TOKEN_TTL_SECONDS = 60 * 60 * 12; // 12 hours

function b64urlEncode(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function b64urlDecode(input: string): Buffer {
  const norm = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = norm.length % 4 === 0 ? "" : "=".repeat(4 - (norm.length % 4));
  return Buffer.from(norm + pad, "base64");
}

function sign(input: string): string {
  return b64urlEncode(createHmac("sha256", env.AUTH_SECRET).update(input).digest());
}

/** Demo uses a lighter scrypt N so sign-in→dashboard can stay under 200ms on local preview. */
const SCRYPT_N = env.DEMO_MODE ? 2048 : 16384;

export function hashPassword(raw: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(raw, salt, 64, { N: SCRYPT_N });
  // v2 embeds N so verify matches the cost used at hash time
  return `v2:${SCRYPT_N}:${salt.toString("hex")}:${derived.toString("hex")}`;
}

export function verifyPassword(raw: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  if (stored.startsWith("v2:")) {
    const parts = stored.split(":");
    const n = Number(parts[1]);
    const saltHex = parts[2];
    const keyHex = parts[3];
    if (!n || !saltHex || !keyHex) return false;
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(keyHex, "hex");
    const actual = scryptSync(raw, salt, expected.length, { N: n });
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  }
  const [saltHex, keyHex] = stored.split(":");
  if (!saltHex || !keyHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(keyHex, "hex");
  // Legacy hashes used Node default N=16384
  const actual = scryptSync(raw, salt, expected.length, { N: 16384 });
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function issueAuthToken(data: {
  userId: string;
  role: AuthRole;
  email: string;
  name: string;
  orgId?: string | null;
  orgRole?: OrgRolePublic | null;
  membershipId?: string | null;
  tokenVersion?: number;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const claims: AuthClaims = {
    sub: data.userId,
    role: data.role,
    email: data.email,
    name: data.name,
    orgId: data.orgId ?? null,
    orgRole: data.orgRole ?? null,
    membershipId: data.membershipId ?? null,
    tokenVersion: data.tokenVersion ?? 0,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  };
  const payload = b64urlEncode(JSON.stringify(claims));
  const sig = sign(payload);
  return `${payload}.${sig}`;
}

export function verifyAuthToken(token: string): AuthClaims | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expectedSig = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;
  try {
    const claims = JSON.parse(b64urlDecode(payload).toString("utf8")) as AuthClaims;
    const now = Math.floor(Date.now() / 1000);
    if (!claims?.sub || !claims?.role || !claims?.exp || claims.exp < now) return null;
    if (claims.role !== "user" && claims.role !== "admin" && claims.role !== "owner") return null;
    return {
      ...claims,
      orgId: claims.orgId ?? null,
      orgRole: claims.orgRole ?? null,
      membershipId: claims.membershipId ?? null,
      tokenVersion: claims.tokenVersion ?? 0,
    };
  } catch {
    return null;
  }
}
