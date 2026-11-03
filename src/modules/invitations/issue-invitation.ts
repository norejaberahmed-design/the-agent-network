import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { MembershipRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type InvitationMembershipRole = Exclude<MembershipRole, "OWNER">;

export type IssueInvitationInput = {
  createdById: string;
  email?: string | null;
  expiresInHours: number;
  organizationId?: string | null;
  role?: InvitationMembershipRole | null;
};

export async function issueInvitation(input: IssueInvitationInput) {
  if (Boolean(input.organizationId) !== Boolean(input.role)) {
    throw new Error("Organization-scoped invitations require a membership role.");
  }

  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + input.expiresInHours * 60 * 60 * 1000);
  const correlationId = randomUUID();

  const invitation = await prisma.$transaction(async (tx) => {
    const created = await tx.invitation.create({
      data: {
        tokenHash,
        intendedEmail: input.email?.trim().toLowerCase() ?? null,
        organizationId: input.organizationId ?? null,
        role: input.role ?? null,
        expiresAt,
        createdById: input.createdById,
      },
      select: {
        id: true,
        intendedEmail: true,
        organizationId: true,
        role: true,
        expiresAt: true,
        status: true,
      },
    });

    await tx.auditEvent.create({
      data: {
        actorUserId: input.createdById,
        ownerType: input.organizationId ? "ORGANIZATION" : null,
        ownerId: input.organizationId ?? null,
        action: "invitation.created",
        targetType: "Invitation",
        targetId: created.id,
        outcome: "COMPLETED",
        correlationId,
        metadata: {
          intendedEmail: created.intendedEmail,
          organizationId: created.organizationId,
          role: created.role,
          expiresAt: created.expiresAt.toISOString(),
        },
      },
    });

    return created;
  });

  return { invitation, token, correlationId };
}
