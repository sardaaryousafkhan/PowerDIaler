import { timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { env } from "../env.js";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function extractApiKey(req: FastifyRequest): string | undefined {
  const header = req.headers["x-api-key"];
  if (typeof header === "string" && header.trim()) return header.trim();
  const authz = String(req.headers.authorization ?? "");
  if (authz.toLowerCase().startsWith("bearer ")) {
    return authz.slice(7).trim();
  }
  return undefined;
}

export function verifyApiKey(req: FastifyRequest): boolean {
  const provided = extractApiKey(req);
  if (!provided) return false;
  return safeEqual(provided, env.BRIDGE_API_KEY);
}
