import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import { isTrustedMutationRequest } from "@/lib/request-security";
import { prisma } from "@/lib/prisma";
import { updatePersonalMemorySchema } from "@/modules/memory/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ memoryId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  if (!(await isTrustedMutationRequest(request))) return apiError("INVALID_ORIGIN", 403);
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return apiError("UNAUTHENTICATED", 401);
  let input: unknown;
  try { input = await request.json(); } catch { return apiError("INVALID_JSON", 400); }
  const parsed = updatePersonalMemorySchema.safeParse(input);
  if (!parsed.success) return apiError("VALIDATION_FAILED", 422, parsed.error.flatten());
  const { memoryId } = await context.params;
  const current = await prisma.personalMemory.findFirst({
    where: { id: memoryId, userId: session.user.id, status: { not: "DELETED" } },
    select: { id: true, kind: true, version: true },
  });
  if (!current) return apiError("NOT_FOUND", 404);
  if (parsed.data.confirm && current.kind !== "INFERRED") return apiError("CONFLICT", 409);

  const correlationId = randomUUID();
  const saved = await prisma.$transaction(async (tx) => {
    const updated = await tx.personalMemory.updateMany({
      where: { id: memoryId, userId: session.user.id, version: current.version, status: { not: "DELETED" } },
      data: {
        ...(parsed.data.content ? { content: parsed.data.content } : {}),
        ...(parsed.data.status ? { status: parsed.data.status } : {}),
        ...(parsed.data.confirm ? { kind: "CONFIRMED", sourceType: "USER_CONFIRMED", confidence: null, confirmedAt: new Date(), expiresAt: null } : {}),
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) return null;
    const result = await tx.personalMemory.findUnique({ where: { id: memoryId } });
    if (!result) return null;
    await tx.auditEvent.create({
      data: {
        actorUserId: session.user.id,
        action: parsed.data.confirm ? "personal_memory.confirmed" : "personal_memory.updated",
        targetType: "PersonalMemory",
        targetId: memoryId,
        outcome: "COMPLETED",
        correlationId,
        metadata: { kind: result.kind, status: result.status, version: result.version },
      },
    });
    return result;
  });
  if (!saved) return apiError("CONFLICT", 409);
  const { userId: _userId, ...publicMemory } = saved;
  return Response.json({ data: publicMemory, correlationId }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: Request, context: RouteContext) {
  if (!(await isTrustedMutationRequest(request))) return apiError("INVALID_ORIGIN", 403);
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return apiError("UNAUTHENTICATED", 401);
  const { memoryId } = await context.params;
  const correlationId = randomUUID();
  const deleted = await prisma.$transaction(async (tx) => {
    const result = await tx.personalMemory.updateMany({
      where: { id: memoryId, userId: session.user.id, status: { not: "DELETED" } },
      data: { status: "DELETED", content: "[deleted]", sourceReference: null, confidence: null, version: { increment: 1 } },
    });
    if (result.count !== 1) return false;
    await tx.auditEvent.create({
      data: {
        actorUserId: session.user.id,
        action: "personal_memory.deleted",
        targetType: "PersonalMemory",
        targetId: memoryId,
        outcome: "COMPLETED",
        correlationId,
      },
    });
    return true;
  });
  if (!deleted) return apiError("NOT_FOUND", 404);
  return Response.json({ data: { id: memoryId, status: "DELETED" }, correlationId }, { headers: { "Cache-Control": "no-store" } });
}
