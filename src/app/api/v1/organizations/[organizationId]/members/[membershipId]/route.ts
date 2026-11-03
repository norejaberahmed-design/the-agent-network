import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import { isTrustedMutationRequest } from "@/lib/request-security";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ organizationId: string; membershipId: string }>;
};

const memberRoleSchema = z.object({
  role: z.enum(["ADMIN", "AGENT_MANAGER", "OPERATOR", "AUDITOR", "VIEWER"]),
});

export async function PATCH(request: Request, context: RouteContext) {
  if (!(await isTrustedMutationRequest(request))) return apiError("INVALID_ORIGIN", 403);

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return apiError("UNAUTHENTICATED", 401);

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return apiError("INVALID_JSON", 400);
  }
  const parsed = memberRoleSchema.safeParse(input);
  if (!parsed.success) {
    return apiError("VALIDATION_FAILED", 422, parsed.error.flatten());
  }

  const { organizationId, membershipId } = await context.params;
  const result = await prisma.$transaction(async (tx) => {
    const actor = await tx.membership.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId: session.user.id,
        },
      },
      select: { role: true },
    });
    if (!actor || (actor.role !== "OWNER" && actor.role !== "ADMIN")) {
      return { state: "FORBIDDEN" as const };
    }

    const target = await tx.membership.findFirst({
      where: { id: membershipId, organizationId },
      select: { id: true, userId: true, role: true },
    });
    if (!target) return { state: "NOT_FOUND" as const };
    if (target.role === "OWNER") return { state: "FORBIDDEN" as const };
    if (
      actor.role === "ADMIN" &&
      (target.role === "ADMIN" || parsed.data.role === "ADMIN")
    ) {
      return { state: "FORBIDDEN" as const };
    }
    if (target.role === parsed.data.role) {
      return { state: "UPDATED" as const, role: target.role };
    }

    const changed = await tx.membership.updateMany({
      where: {
        id: membershipId,
        organizationId,
        role: target.role,
      },
      data: { role: parsed.data.role },
    });
    if (changed.count !== 1) return { state: "CONFLICT" as const };

    const revokedInvitations = await tx.invitation.updateMany({
      where: {
        organizationId,
        createdById: target.userId,
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
          actorUserId: session.user.id,
          ownerType: "ORGANIZATION",
          ownerId: organizationId,
          action: "organization.member.invitations_revoked",
          targetType: "Membership",
          targetId: membershipId,
          outcome: "COMPLETED",
          correlationId: randomUUID(),
          metadata: {
            memberUserId: target.userId,
            invitationCount: revokedInvitations.count,
            reason: "ROLE_CHANGED",
          },
        },
      });
    }

    await tx.auditEvent.create({
      data: {
        actorUserId: session.user.id,
        ownerType: "ORGANIZATION",
        ownerId: organizationId,
        action: "organization.member.role_changed",
        targetType: "Membership",
        targetId: membershipId,
        outcome: "COMPLETED",
        correlationId: randomUUID(),
        metadata: {
          memberUserId: target.userId,
          previousRole: target.role,
          newRole: parsed.data.role,
        },
      },
    });

    return { state: "UPDATED" as const, role: parsed.data.role };
  });

  if (result.state === "FORBIDDEN") return apiError("FORBIDDEN", 403);
  if (result.state === "NOT_FOUND") return apiError("NOT_FOUND", 404);
  if (result.state === "CONFLICT") return apiError("CONFLICT", 409);

  return Response.json(
    { data: { membershipId, role: result.role } },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function DELETE(request: Request, context: RouteContext) {
  if (!(await isTrustedMutationRequest(request))) return apiError("INVALID_ORIGIN", 403);

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return apiError("UNAUTHENTICATED", 401);

  const { organizationId, membershipId } = await context.params;
  const result = await prisma.$transaction(async (tx) => {
    const actor = await tx.membership.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId: session.user.id,
        },
      },
      select: { role: true },
    });
    if (!actor || (actor.role !== "OWNER" && actor.role !== "ADMIN")) {
      return { state: "FORBIDDEN" as const };
    }

    const target = await tx.membership.findFirst({
      where: { id: membershipId, organizationId },
      select: { id: true, userId: true, role: true },
    });
    if (!target) return { state: "NOT_FOUND" as const };
    if (target.role === "OWNER") return { state: "FORBIDDEN" as const };
    if (actor.role === "ADMIN" && target.role === "ADMIN") {
      return { state: "FORBIDDEN" as const };
    }

    const deleted = await tx.membership.deleteMany({
      where: {
        id: membershipId,
        organizationId,
        role: target.role,
      },
    });
    if (deleted.count !== 1) return { state: "CONFLICT" as const };

    const revokedInvitations = await tx.invitation.updateMany({
      where: {
        organizationId,
        createdById: target.userId,
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
          actorUserId: session.user.id,
          ownerType: "ORGANIZATION",
          ownerId: organizationId,
          action: "organization.member.invitations_revoked",
          targetType: "Membership",
          targetId: membershipId,
          outcome: "COMPLETED",
          correlationId: randomUUID(),
          metadata: {
            memberUserId: target.userId,
            invitationCount: revokedInvitations.count,
            reason: "MEMBER_REMOVED",
          },
        },
      });
    }

    await tx.auditEvent.create({
      data: {
        actorUserId: session.user.id,
        ownerType: "ORGANIZATION",
        ownerId: organizationId,
        action: "organization.member.removed",
        targetType: "Membership",
        targetId: membershipId,
        outcome: "COMPLETED",
        correlationId: randomUUID(),
        metadata: {
          memberUserId: target.userId,
          previousRole: target.role,
        },
      },
    });

    return { state: "REMOVED" as const };
  });

  if (result.state === "FORBIDDEN") return apiError("FORBIDDEN", 403);
  if (result.state === "NOT_FOUND") return apiError("NOT_FOUND", 404);
  if (result.state === "CONFLICT") return apiError("CONFLICT", 409);

  return Response.json(
    { data: { membershipId, status: "REMOVED" } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
