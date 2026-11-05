import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import { isTrustedMutationRequest } from "@/lib/request-security";
import { prisma } from "@/lib/prisma";
import { updatePersonaSchema } from "@/modules/users/persona-contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return apiError("UNAUTHENTICATED", 401);

  const persona = await prisma.userPersona.findUnique({
    where: { userId: session.user.id },
    select: {
      displayName: true,
      tone: true,
      goal: true,
      memoryContextEnabled: true,
      memoryLearningEnabled: true,
      version: true,
      updatedAt: true,
    },
  });

  return Response.json(
    { data: persona },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(request: Request) {
  if (!(await isTrustedMutationRequest(request))) return apiError("INVALID_ORIGIN", 403);

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return apiError("UNAUTHENTICATED", 401);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return apiError("INVALID_JSON", 400);
  }

  const parsed = updatePersonaSchema.safeParse(payload);
  if (!parsed.success) {
    return apiError("VALIDATION_FAILED", 422, parsed.error.flatten());
  }

  const correlationId = randomUUID();
  const persona = await prisma.$transaction(async (tx) => {
    const saved = await tx.userPersona.upsert({
      where: { userId: session.user.id },
      create: { userId: session.user.id, ...parsed.data },
      update: { ...parsed.data, version: { increment: 1 } },
      select: {
        displayName: true,
        tone: true,
        goal: true,
        memoryContextEnabled: true,
        version: true,
        updatedAt: true,
      },
    });

    await tx.auditEvent.create({
      data: {
        actorUserId: session.user.id,
        action: "user.persona.updated",
        targetType: "UserPersona",
        targetId: session.user.id,
        outcome: "COMPLETED",
        correlationId,
        metadata: { changedFields: ["displayName", "tone", "goal", ...(parsed.data.memoryContextEnabled !== undefined ? ["memoryContextEnabled"] : []), ...(parsed.data.memoryLearningEnabled !== undefined ? ["memoryLearningEnabled"] : [])], version: saved.version },
      },
    });

    return saved;
  });

  return Response.json(
    { data: persona, correlationId },
    { headers: { "Cache-Control": "no-store" } },
  );
}
