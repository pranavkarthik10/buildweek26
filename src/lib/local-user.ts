import { prisma } from "@/lib/db";

// Local development identity for the current app.
export const LOCAL_USER_ID = "local-user";

export async function ensureLocalUser() {
  return prisma.user.upsert({
    where: { id: LOCAL_USER_ID },
    update: {},
    create: {
      id: LOCAL_USER_ID,
      email: "local@example.com",
      name: "Local learner",
    },
  });
}
