import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";

export type MemberDelegationRevocationReason = "ROLE_CHANGED" | "MEMBER_REMOVED";

export async function revokeMemberDelegations(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    membershipId: string;
    memberUserId: string;
    actorUserId: string;
    reason: MemberDelegationRevocationReason;
  },
) {
  const revokedInvitations = await tx.invitation.updateMany({
    where: {
      organizationId: input.organizationId,
      createdById: input.memberUserId,
      status: { in: ["PENDING", "RESERVED"] },
    },
    data: {
      status: "REVOKED",
      reservationId: null,
      reservationExpiresAt: null,
    },
  });

  if (revokedInvitations.count > 0) {
    await tx.auditEvent.create({
      data: {
        actorUserId: input.actorUserId,
        ownerType: "ORGANIZATION",
        ownerId: input.organizationId,
        action: "organization.member.invitations_revoked",
        targetType: "Membership",
        targetId: input.membershipId,
        outcome: "COMPLETED",
        correlationId: randomUUID(),
        metadata: {
          memberUserId: input.memberUserId,
          invitationCount: revokedInvitations.count,
          reason: input.reason,
        },
      },
    });
  }

  // PermissionGrant has no creator column yet. Its creation audit event is
  // the authoritative provenance link used to find grants delegated by this
  // member within this organization.
  const grantEvents = await tx.auditEvent.findMany({
    where: {
      ownerType: "ORGANIZATION",
      ownerId: input.organizationId,
      actorUserId: input.memberUserId,
      action: "permission_grant.created",
      targetType: "PermissionGrant",
      targetId: { not: null },
    },
    select: { targetId: true },
  });
  const grantIds = [...new Set(
    grantEvents
      .map((event) => event.targetId)
      .filter((id): id is string => Boolean(id)),
  )];

  let revokedGrantCount = 0;
  for (const grantId of grantIds) {
    const grant = await tx.permissionGrant.findUnique({
      where: { id: grantId },
      select: { id: true, agentId: true, status: true, version: true },
    });
    if (!grant || grant.status !== "ACTIVE") continue;

    const changed = await tx.permissionGrant.updateMany({
      where: { id: grantId, status: "ACTIVE" },
      data: {
        status: "REVOKED",
        revokedAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (changed.count !== 1) continue;

    revokedGrantCount += 1;
    await tx.auditEvent.create({
      data: {
        actorUserId: input.actorUserId,
        agentId: grant.agentId,
        ownerType: "ORGANIZATION",
        ownerId: input.organizationId,
        action: "permission_grant.revoked",
        targetType: "PermissionGrant",
        targetId: grant.id,
        outcome: "COMPLETED",
        policyVersion: String(grant.version + 1),
        correlationId: randomUUID(),
        metadata: {
          reason: "MEMBER_OFFBOARDING",
          memberUserId: input.memberUserId,
        },
      },
    });
  }

  if (revokedGrantCount > 0) {
    await tx.auditEvent.create({
      data: {
        actorUserId: input.actorUserId,
        ownerType: "ORGANIZATION",
        ownerId: input.organizationId,
        action: "organization.member.grants_revoked",
        targetType: "Membership",
        targetId: input.membershipId,
        outcome: "COMPLETED",
        correlationId: randomUUID(),
        metadata: {
          memberUserId: input.memberUserId,
          grantCount: revokedGrantCount,
          reason: input.reason,
        },
      },
    });
  }

  return {
    revokedInvitationCount: revokedInvitations.count,
    revokedGrantCount,
  };
}
