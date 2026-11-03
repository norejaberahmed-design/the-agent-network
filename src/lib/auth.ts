import { createHash, randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "@/lib/prisma";

const secret = process.env.BETTER_AUTH_SECRET;
if (!secret || secret.length < 32) {
  throw new Error("BETTER_AUTH_SECRET must be set to at least 32 characters.");
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export const auth = betterAuth({
  secret,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  user: {
    additionalFields: {
      platformRole: {
        type: "string",
        required: false,
        defaultValue: "MEMBER",
        input: false,
      },
    },
  },
  emailAndPassword: {
    enabled: true,
    disableSignUp: false,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    autoSignIn: true,
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-up/email") return;

      const email =
        typeof ctx.body?.email === "string" ? ctx.body.email.trim().toLowerCase() : "";
      const bootstrapToken = process.env.TAN_BOOTSTRAP_TOKEN;
      const bootstrapEmail = process.env.TAN_BOOTSTRAP_ADMIN_EMAIL?.toLowerCase();
      const suppliedBootstrapToken = ctx.headers?.get("x-bootstrap-token") ?? null;

      if (
        bootstrapToken &&
        bootstrapEmail &&
        suppliedBootstrapToken === bootstrapToken &&
        email === bootstrapEmail
      ) {
        return;
      }

      const invitationToken = ctx.headers?.get("x-invitation-token") ?? null;
      if (!invitationToken || !email) {
        throw new APIError("FORBIDDEN", {
          message: "A valid invitation is required to create an account.",
        });
      }

      const tokenHash = sha256(invitationToken);
      const invitation = await prisma.invitation.findUnique({
        where: { tokenHash },
      });
      const now = new Date();

      if (
        !invitation ||
        invitation.expiresAt <= now ||
        (invitation.intendedEmail &&
          invitation.intendedEmail.toLowerCase() !== email)
      ) {
        throw new APIError("FORBIDDEN", {
          message: "The invitation is invalid, expired, or assigned to another email.",
        });
      }

      const reservationId = ctx.headers?.get("x-invitation-reservation-id") ?? null;
      if (!reservationId || !/^[0-9a-f-]{36}$/i.test(reservationId)) {
        throw new APIError("FORBIDDEN", {
          message: "A valid invitation redemption request is required.",
        });
      }

      const reservation = await prisma.invitation.updateMany({
        where: {
          id: invitation.id,
          expiresAt: { gt: now },
          OR: [
            { status: "PENDING" },
            {
              status: "RESERVED",
              reservationExpiresAt: { lt: now },
            },
          ],
        },
        data: {
          status: "RESERVED",
          reservationId,
          reservationExpiresAt: new Date(now.getTime() + 10 * 60 * 1000),
        },
      });

      if (reservation.count !== 1) {
        throw new APIError("FORBIDDEN", {
          message: "The invitation has already been used or is being redeemed.",
        });
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-up/email") return;

      const newSession = ctx.context.newSession;
      const invitationToken = ctx.headers?.get("x-invitation-token") ?? null;
      if (!newSession || !invitationToken) return;

      const reservationId = ctx.headers?.get("x-invitation-reservation-id") ?? null;
      const email = newSession.user.email.trim().toLowerCase();
      const tokenHash = sha256(invitationToken);
      const now = new Date();

      try {
        if (!reservationId || !/^[0-9a-f-]{36}$/i.test(reservationId)) {
          throw new Error("Invitation reservation identifier is missing.");
        }

        const invitation = await prisma.invitation.findUnique({
          where: { tokenHash },
          select: { id: true, intendedEmail: true },
        });
        if (!invitation || (invitation.intendedEmail && invitation.intendedEmail.toLowerCase() !== email)) {
          throw new Error("Invitation does not match the newly created account.");
        }

        await prisma.$transaction(async (tx) => {
          const redeemed = await tx.invitation.updateMany({
            where: {
              id: invitation.id,
              tokenHash,
              status: "RESERVED",
              reservationId,
              reservationExpiresAt: { gt: now },
              expiresAt: { gt: now },
              OR: [{ intendedEmail: null }, { intendedEmail: email }],
            },
            data: {
              status: "REDEEMED",
              redeemedAt: now,
              reservationId: null,
              reservationExpiresAt: null,
            },
          });

          if (redeemed.count !== 1) {
            throw new Error("Invitation reservation is no longer valid.");
          }

          await tx.auditEvent.create({
            data: {
              actorUserId: newSession.user.id,
              action: "invitation.redeemed",
              targetType: "Invitation",
              targetId: invitation.id,
              outcome: "COMPLETED",
              correlationId: randomUUID(),
              metadata: { accountId: newSession.user.id },
            },
          });
        });
      } catch {
        await prisma.user.deleteMany({ where: { id: newSession.user.id } });
        throw new APIError("FORBIDDEN", {
          message: "Invitation redemption could not be completed. The new account was not retained.",
        });
      }
    }),
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: false },
  },
  advanced: {
    useSecureCookies: process.env.NODE_ENV === "production",
  },
});
