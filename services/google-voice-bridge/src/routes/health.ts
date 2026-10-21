import type { FastifyInstance } from "fastify";
import { ccaiAuthStatus } from "../voice/ccaiClient.js";
import { ccaiConfigured, env } from "../env.js";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => {
    const mode = env.GOOGLE_VOICE_BRIDGE_MODE;
    const ccaiAuth = ccaiAuthStatus();
    const ccaiReady = mode === "ccai" ? ccaiConfigured() : false;

    let googleVoiceReady = false;
    let smsEnabled = false;

    if (mode === "mock") {
      googleVoiceReady = true;
      smsEnabled = true;
    } else if (mode === "hybrid") {
      googleVoiceReady = true;
      smsEnabled = false;
    } else if (mode === "ccai") {
      googleVoiceReady = ccaiReady;
      smsEnabled = ccaiReady;
    }

    return {
      ok: true,
      googleAuth: mode === "ccai" ? ccaiAuth : mode === "mock" ? "mock" : "hybrid",
      googleVoiceReady,
      smsEnabled,
      mode,
      provider: "google_voice",
    };
  });
}
