import { auth } from "../src/lib/auth";
import { prisma } from "../src/lib/prisma";

async function main() {
  const email = process.env.TAN_BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.TAN_BOOTSTRAP_ADMIN_PASSWORD;
  const name = process.env.TAN_BOOTSTRAP_ADMIN_NAME ?? "Platform Administrator";
  const token = process.env.TAN_BOOTSTRAP_TOKEN;

  if (!email || !password || !token || token.length < 32) {
    throw new Error(
      "Set TAN_BOOTSTRAP_ADMIN_EMAIL, TAN_BOOTSTRAP_ADMIN_PASSWORD, and a 32+ character TAN_BOOTSTRAP_TOKEN.",
    );
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.platformRole !== "PLATFORM_ADMIN") {
      throw new Error("The bootstrap email already exists but is not a platform administrator.");
    }
    console.log("Platform administrator already exists; no changes made.");
    return;
  }

  await auth.api.signUpEmail({
    body: { name, email, password },
    headers: new Headers({ "x-bootstrap-token": token }),
  });

  const created = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true },
  });

  if (!created) {
    throw new Error("Bootstrap sign-up completed but the account could not be found.");
  }

  const promoted = await prisma.user.update({
    where: { id: created.id },
    data: { platformRole: "PLATFORM_ADMIN" },
    select: { id: true, email: true, platformRole: true },
  });

  if (promoted.platformRole !== "PLATFORM_ADMIN") {
    throw new Error("Could not assign the initial platform administrator role.");
  }

  console.log(`Created initial platform administrator: ${promoted.email}`);
  console.log("Remove TAN_BOOTSTRAP_TOKEN and TAN_BOOTSTRAP_ADMIN_* values from the runtime environment now.");
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Bootstrap failed.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
