import { SMS_PER_MINUTE_DEFAULT } from "@powerdialer/shared";
import { prisma } from "../db.js";

export async function getOrgIntegrationPreference(organizationId: string) {
  let preference = await prisma.integrationPreference.findUnique({
    where: { organizationId },
  });
  if (!preference) {
    preference = await prisma.integrationPreference.create({
      data: {
        organizationId,
        preferredIntegrationKey: "twilio",
        smsPerMinute: SMS_PER_MINUTE_DEFAULT,
      },
    });
  }
  return preference;
}

export async function upsertOrgSmsPerMinute(organizationId: string, smsPerMinute: number) {
  return prisma.integrationPreference.upsert({
    where: { organizationId },
    create: {
      organizationId,
      preferredIntegrationKey: "twilio",
      smsPerMinute,
    },
    update: { smsPerMinute },
  });
}
