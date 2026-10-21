import type { FastifyInstance } from "fastify";
import { verifyZoomWebhookSignature } from "../auth/zoomWebhook.js";
import { handleZoomPhoneWebhook } from "../zoom/webhookHandler.js";

/**
 * IMPORTANT: this plugin MUST stay encapsulated (do NOT wrap with `fastify-plugin`).
 * It overrides the JSON parser to preserve the raw body for Zoom HMAC verification.
 * If anyone hoists or de-encapsulates these routes, every other JSON route in the
 * bridge will start receiving string bodies and Zod validators will fail.
 */
export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    done(null, body);
  });

  app.post("/webhook", async (req, reply) => {
    const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {});
    const signature = req.headers["x-zm-signature"] as string | undefined;
    const timestamp = req.headers["x-zm-request-timestamp"] as string | undefined;

    if (!verifyZoomWebhookSignature(rawBody, signature, timestamp)) {
      return reply.code(401).send({ error: "Invalid Zoom signature" });
    }

    let parsed: { event?: string; payload?: { plainToken?: string; object?: Record<string, unknown> } };
    try {
      parsed = JSON.parse(rawBody) as typeof parsed;
    } catch {
      return reply.code(400).send({ error: "Invalid JSON" });
    }

    if (parsed.event === "endpoint.url_validation") {
      const token = parsed.payload?.plainToken;
      if (token) {
        return reply.send({ plainToken: token, encryptedToken: token });
      }
    }

    await handleZoomPhoneWebhook(parsed, rawBody);
    return reply.send({ ok: true });
  });
}
