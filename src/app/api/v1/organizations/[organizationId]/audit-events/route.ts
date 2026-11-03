import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { projectSafeAuditMetadata } from "@/modules/audit/safe-audit-metadata";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ organizationId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return apiError("UNAUTHENTICATED", 401);

  const { organizationId } = await context.params;
  const membership = await prisma.membership.findUnique({
    where: {
      organizationId_userId: {
        organizationId,
        userId: session.user.id,
      },
    },
    select: { role: true },
  });
  if (
    !membership ||
    (membership.role !== "OWNER" &&
      membership.role !== "ADMIN" &&
      membership.role !== "AUDITOR")
  ) {
    return apiError("FORBIDDEN", 403);
  }

  const cursor = new URL(request.url).searchParams.get("cursor") ?? undefined;
  if (cursor && cursor.length > 128) return apiError("VALIDATION_FAILED", 422);

  if (cursor) {
    const cursorEvent = await prisma.auditEvent.findFirst({
      where: {
        id: cursor,
        ownerType: "ORGANIZATION",
        ownerId: organizationId,
      },
      select: { id: true },
    });
    if (!cursorEvent) return apiError("VALIDATION_FAILED", 422);
  }

  const events = await prisma.auditEvent.findMany({
    where: {
      ownerType: "ORGANIZATION",
      ownerId: organizationId,
    },
    select: {
      id: true,
      action: true,
      targetType: true,
      targetId: true,
      outcome: true,
      policyVersion: true,
      occurredAt: true,
      metadata: true,
      actor: { select: { id: true, name: true } },
    },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: 50,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  return Response.json(
    {
      data: events.map((event) => ({
        id: event.id,
        actor: event.actor,
        action: event.action,
        targetType: event.targetType,
        targetId: event.targetId,
        outcome: event.outcome,
        policyVersion: event.policyVersion,
        occurredAt: event.occurredAt,
        metadata: projectSafeAuditMetadata(event.action, event.metadata),
      })),
      nextCursor: events.length === 50 ? events[events.length - 1].id : null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
