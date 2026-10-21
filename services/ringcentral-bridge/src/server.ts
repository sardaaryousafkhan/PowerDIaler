import Fastify from "fastify";
import { z } from "zod";
import { bridgeCallTypeSchema } from "@powerdialer/shared";
import { env } from "./env.js";
import { verifyApiKey } from "./auth.js";
import { placeCall, placeSms } from "./dialer.js";

const app = Fastify({ logger: true });

const dialBodySchema = z.object({
  provider: z.literal("ringcentral"),
  toE164: z.string().min(8),
  fromE164: z.string().min(8),
  campaignId: z.string().min(1),
  contactId: z.string().min(1),
  callType: bridgeCallTypeSchema.default("agent"),
  idempotencyKey: z.string().min(1),
  statusCallbackUrl: z.string().url(),
  correlationId: z.string().optional(),
  voiceMessage: z.string().optional(),
  voicemailDropEnabled: z.boolean().optional(),
});

const smsBodySchema = z.object({
  provider: z.literal("ringcentral"),
  toE164: z.string().min(8),
  fromE164: z.string().min(8),
  body: z.string().min(1),
  idempotencyKey: z.string().min(1),
  statusCallbackUrl: z.string().url().optional(),
  correlationId: z.string().optional(),
});

app.get("/health", async () => ({
  ok: true,
  provider: "ringcentral",
  mode: env.RINGCENTRAL_BRIDGE_MODE,
  smsEnabled: true,
}));

app.post("/dial", async (req, reply) => {
  if (!verifyApiKey(req)) {
    return reply.code(401).send({ error: "Unauthorized" });
  }
  const parsed = dialBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: parsed.error.message });
  }
  const data = parsed.data;
  const allowedHost = new URL(env.POWER_DIALER_PUBLIC_URL).host;
  let callbackHost: string;
  try {
    callbackHost = new URL(data.statusCallbackUrl).host;
  } catch {
    return reply.code(400).send({ error: "Invalid statusCallbackUrl" });
  }
  if (callbackHost !== allowedHost && !callbackHost.startsWith("127.0.0.1")) {
    return reply.code(400).send({ error: "statusCallbackUrl host not allowed" });
  }

  try {
    const result = await placeCall({
      toE164: data.toE164,
      fromE164: data.fromE164,
      campaignId: data.campaignId,
      contactId: data.contactId,
      idempotencyKey: data.idempotencyKey,
      statusCallbackUrl: data.statusCallbackUrl,
    });
    return reply.send(result);
  } catch (e) {
    req.log.error(e);
    return reply.code(502).send({
      error: e instanceof Error ? e.message : "RingCentral dial failed",
    });
  }
});

app.post("/sms", async (req, reply) => {
  if (!verifyApiKey(req)) {
    return reply.code(401).send({ error: "Unauthorized" });
  }
  const parsed = smsBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: parsed.error.message });
  }
  const data = parsed.data;
  try {
    const result = await placeSms({
      toE164: data.toE164,
      fromE164: data.fromE164,
      body: data.body,
      idempotencyKey: data.idempotencyKey,
      statusCallbackUrl: data.statusCallbackUrl,
    });
    return reply.send(result);
  } catch (e) {
    req.log.error(e);
    return reply.code(502).send({
      error: e instanceof Error ? e.message : "RingCentral SMS failed",
    });
  }
});

await app.listen({ port: env.PORT, host: "0.0.0.0" });
console.log(
  `RingCentral Bridge on http://127.0.0.1:${env.PORT} (mode=${env.RINGCENTRAL_BRIDGE_MODE})`,
);
