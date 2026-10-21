import { prisma } from "../../db.js";
import { hashPassword } from "../../auth.js";

export type Batch1Fixture = {
  orgId: string;
  owner: { userId: string; membershipId: string; email: string };
  adminA: { userId: string; membershipId: string; email: string };
  adminB: { userId: string; membershipId: string; email: string };
  u1: { userId: string; membershipId: string; email: string };
  u2: { userId: string; membershipId: string; email: string };
  u3: { userId: string; membershipId: string; email: string };
  agent: { userId: string; membershipId: string; email: string };
};

export async function seedBatch1Fixture(): Promise<Batch1Fixture> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const passwordHash = hashPassword("TestPass123!");

  const org = await prisma.organization.create({
    data: {
      name: `RBAC Batch1 ${suffix}`,
      slug: `rbac-b1-${suffix}`,
      settings: JSON.stringify({ timezone: "America/New_York" }),
    },
  });

  await prisma.integrationPreference.create({
    data: {
      organizationId: org.id,
      preferredIntegrationKey: "twilio",
      smsPerMinute: 30,
    },
  });

  async function userWithMembership(
    email: string,
    name: string,
    orgRole: "ORG_OWNER" | "ORG_ADMIN" | "AGENT",
    managedByAdminId?: string | null,
  ) {
    const user = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
        role: orgRole === "ORG_OWNER" ? "OWNER" : orgRole === "ORG_ADMIN" ? "ADMIN" : "USER",
      },
    });
    const membership = await prisma.membership.create({
      data: {
        userId: user.id,
        organizationId: org.id,
        orgRole,
        status: "ACTIVE",
        managedByAdminId: managedByAdminId ?? null,
      },
    });
    return { userId: user.id, membershipId: membership.id, email };
  }

  const owner = await userWithMembership(`owner-${suffix}@test.local`, "Owner", "ORG_OWNER");
  const adminA = await userWithMembership(`admin-a-${suffix}@test.local`, "Admin A", "ORG_ADMIN");
  const adminB = await userWithMembership(`admin-b-${suffix}@test.local`, "Admin B", "ORG_ADMIN");
  const u1 = await userWithMembership(`u1-${suffix}@test.local`, "U1", "AGENT", adminA.membershipId);
  const u2 = await userWithMembership(`u2-${suffix}@test.local`, "U2", "AGENT", adminA.membershipId);
  const u3 = await userWithMembership(`u3-${suffix}@test.local`, "U3", "AGENT", adminB.membershipId);
  const agent = await userWithMembership(`agent-${suffix}@test.local`, "Agent Self", "AGENT", adminA.membershipId);

  return { orgId: org.id, owner, adminA, adminB, u1, u2, u3, agent };
}
