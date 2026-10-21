import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { defaultPermissionsForOrgRole } from "@powerdialer/shared";
import { prisma as defaultPrisma } from "../db.js";

const DEFAULT_SLUG = "default-workspace";

/** Idempotent: Default Workspace + attach unscoped rows + memberships. */
export async function runMultitenantBackfill(client: PrismaClient = defaultPrisma) {
  let plan = await client.plan.findUnique({ where: { slug: "starter" } });
  if (!plan) {
    plan = await client.plan.create({
      data: {
        name: "Starter",
        slug: "starter",
        seatLimit: 25,
        smsMonthlyCap: 50_000,
        priceCents: 0,
      },
    });
  }

  let org = await client.organization.findUnique({ where: { slug: DEFAULT_SLUG } });
  if (!org) {
    org = await client.organization.create({
      data: {
        name: "Default Workspace",
        slug: DEFAULT_SLUG,
        planId: plan.id,
        settings: JSON.stringify({ timezone: "America/New_York" }),
      },
    });
    console.log("[backfill] created Default Workspace", org.id);
  }

  await client.subscription.upsert({
    where: { organizationId: org.id },
    create: {
      organizationId: org.id,
      planId: plan.id,
      status: "ACTIVE",
    },
    update: { planId: plan.id, status: "ACTIVE" },
  });

  const prefCount = await client.integrationPreference.count({
    where: { organizationId: org.id },
  });
  if (prefCount === 0) {
    const legacy = await client.integrationPreference.findFirst({
      where: { organizationId: null },
    });
    if (legacy) {
      await client.integrationPreference.update({
        where: { id: legacy.id },
        data: { organizationId: org.id },
      });
    } else {
      await client.integrationPreference.create({
        data: {
          organizationId: org.id,
          preferredIntegrationKey: "ringcentral",
          smsPerMinute: 60,
        },
      });
    }
  }

  const camp = await client.campaign.updateMany({
    where: { organizationId: null },
    data: { organizationId: org.id },
  });
  const dnc = await client.dncEntry.updateMany({
    where: { organizationId: null },
    data: { organizationId: org.id },
  });
  const crmC = await client.crmContact.updateMany({
    where: { organizationId: null },
    data: { organizationId: org.id },
  });
  const crmA = await client.crmActivity.updateMany({
    where: { organizationId: null },
    data: { organizationId: org.id },
  });
  console.log("[backfill] attached", {
    campaigns: camp.count,
    dnc: dnc.count,
    crmContacts: crmC.count,
    crmActivities: crmA.count,
  });

  const users = await client.user.findMany({ select: { id: true, role: true } });
  for (const u of users) {
    const existing = await client.membership.findUnique({
      where: { userId_organizationId: { userId: u.id, organizationId: org.id } },
    });
    if (existing) continue;
    await client.membership.create({
      data: {
        userId: u.id,
        organizationId: org.id,
        orgRole: u.role === "OWNER" ? "ORG_OWNER" : "ORG_ADMIN",
        status: "ACTIVE",
        permissions: JSON.stringify(defaultPermissionsForOrgRole("ORG_ADMIN")),
      },
    });
  }
  console.log("[backfill] memberships ensured for", users.length, "users");
}

const isMain = process.argv[1]?.includes("backfillMultitenant") || process.argv[1]?.includes("backfill-multitenant");
if (isMain) {
  const prisma = new PrismaClient();
  runMultitenantBackfill(prisma)
    .then(() => prisma.$disconnect())
    .catch(async (err) => {
      console.error(err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
