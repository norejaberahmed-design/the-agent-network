import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import { isTrustedMutationRequest } from "@/lib/request-security";
import { prisma } from "@/lib/prisma";
import { createPersonalMemorySchema } from "@/modules/memory/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return apiError("UNAUTHENTICATED", 401);

  const memories = await prisma.personalMemory.findMany({
    where: {
      userId: session.user.id,
      status: "ACTIVE",
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: {
      id: true, kind: true, content: true, sourceType: true, sourceReference: true,
      confidence: true, classification: true, purpose: true, taskContextRunId: true,
      confirmedAt: true, lastObservedAt: true, expiresAt: true, version: true,
      createdAt: true, updatedAt: true,
    },
    orderBy: [{ kind: "asc" }, { updatedAt: "desc" }],
    take: 100,
  });
  return Response.json({ data: memories }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!(await isTrustedMutationRequest(request))) return apiError("INVALID_ORIGIN", 403);
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return apiError("UNAUTHENTICATED", 401);

  let input: unknown;
  try { input = await request.json(); } catch { return apiError("INVALID_JSON", 400); }
  const parsed = createPersonalMemorySchema.safeParse(input);
  if (!parsed.success) return apiError("VALIDATION_FAILED", 422, parsed.error.flatten());

  const now = new Date();
  const taskExpiry = parsed.data.kind === "TASK_CONTEXT" ? new Date(parsed.data.expiresAt) : null;
  if (taskExpiry && (taskExpiry <= now || taskExpiry.getTime() > now.getTime() + 7 * 24 * 60 * 60 * 1000)) {
    return apiError("VALIDATION_FAILED", 422, { expiresAt: ["Task context must expire within seven days."] });
  }

  const correlationId = randomUUID();
  const memory = await prisma.$transaction(async (tx) => {
    const created = await tx.personalMemory.create({
      data: {
        userId: session.user.id,
        kind: parsed.data.kind,
        content: parsed.data.content,
        sourceType: parsed.data.kind === "CONFIRMED" ? "USER_STATEMENT" : "TASK",
        sourceReference: parsed.data.sourceReference,
        purpose: parsed.data.purpose,
        classification: parsed.data.classification,
        taskContextRunId: parsed.data.kind === "TASK_CONTEXT" ? parsed.data.taskContextRunId : null,
        confirmedAt: parsed.data.kind === "CONFIRMED" ? now : null,
        expiresAt: taskExpiry,
      },
      select: {
        id: true, kind: true, content: true, sourceType: true, sourceReference: true,
        confidence: true, classification: true, purpose: true, taskContextRunId: true,
        confirmedAt: true, lastObservedAt: true, expiresAt: true, version: true,
        createdAt: true, updatedAt: true,
      },
    });
    await tx.auditEvent.create({
      data: {
        actorUserId: session.user.id,
        action: "personal_memory.created",
        targetType: "PersonalMemory",
        targetId: created.id,
        outcome: "COMPLETED",
        correlationId,
        metadata: { kind: created.kind, classification: created.classification, purpose: created.purpose },
      },
    });
    return created;
  });
  return Response.json({ data: memory, correlationId }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
