import { randomUUID } from "node:crypto";
import type { DialProvider, SmsProvider } from "@powerdialer/providers";

export function createDemoDialProvider(): DialProvider {
  return {
    async placeCall(_input) {
      return {
        ok: true,
        externalCallId: `DEMO_CA_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
      };
    },
    parseVoiceWebhook() {
      return { error: "Voice webhooks are not used in DEMO_MODE" };
    },
  };
}

export function createDemoSmsProvider(): SmsProvider {
  return {
    async sendSms() {
      return {
        ok: true,
        externalMessageId: `DEMO_SM_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
      };
    },
    parseSmsWebhook() {
      return { error: "SMS webhooks are not used in DEMO_MODE" };
    },
  };
}
