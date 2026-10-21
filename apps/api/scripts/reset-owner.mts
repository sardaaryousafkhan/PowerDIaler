import { prisma } from "../src/db.js";
import { hashPassword } from "../src/auth.js";

const email = "owner@powerdialer.local";
const password = "OwnerChangeMe123!";
const users = await prisma.user.findMany({ select: { id: true, email: true, role: true } });
console.log("users", users);
await prisma.user.upsert({
  where: { email },
  create: { name: "Master Owner", email, passwordHash: hashPassword(password), role: "OWNER" },
  update: { passwordHash: hashPassword(password), role: "OWNER" },
});
console.log("owner password reset");
await prisma.$disconnect();
