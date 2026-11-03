import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";

export type CompleteInvitationRedemptionInput = {
  tokenHash: string;
  reservationId: string;
  userId: string;
  email: string;
  now?: Date;
};

/**
 * Atomically consumes a reserved invitation, grants its optional organization
 * membership, and writes the redemption audit event.
 *
 * The caller is responsible for authenticating the new account and deleting
 * that account if this operation fails.
 */
export async function completeInvitationRedemption(
  input: CompleteInvitationRedemptionInput,
) {
  const now = input.now ?? new Date();
  const email = input.email.trim().toLowerCase();

  return prisma.$transaction(async (tx) => {
    const invitation = await tx.invitation.findUnique({
      where: { tokenHash: input.tokenHash },
      select: {
        id: true,
        intendedEmail: true,
        organizationId: true,
        role: true,
      },
    });

    if (
      !invitation ||
      (invitation.intendedEmail &&
        invitation.intendedEmail.trim().toLowerCase() !== email)
    ) {
      throw new Error("Invitation is missing or assigned to another email.");
    }

    if (Boolean(invitation.organizationId) !== Boolean(invitation.role)) {
      throw new Error("Invitation organization and role are inconsistent.");
    }

    const redeemed = await tx.invitation.updateMany({
      where: {
        id: invitation.id,
        tokenHash: input.tokenHash,
        status: "RESERVED",
        reservationId: input.reservationId,
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

    if (invitation.organizationId && invitation.role) {
      await tx.membership.create({
        data: {
          organizationId: invitation.organizationId,
          userId: input.userId,
          role: invitation.role,
        },
      });
    }

    await tx.auditEvent.create({
      data: {
        actorUserId: input.userId,
        action: "invitation.redeemed",
        targetType: "Invitation",
        targetId: invitation.id,
        outcome: "COMPLETED",
        correlationId: randomUUID(),
        metadata: {
          accountId: input.userId,
          organizationId: invitation.organizationId,
          role: invitation.role,
        },
      },
    });

    return {
      invitationId: invitation.id,
      organizationId: invitation.organizationId,
      role: invitation.role,
    };
  });
}
