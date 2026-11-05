import { randomUUID } from "node:crypto";
import { z } from "zod";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import { isTrustedMutationRequest } from "@/lib/request-security";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ suggestionId: string }> };

const reviewSchema = z.object({
  action: z.enum(["ACCEPT", "REJECT"]),
  content: z.string().trim().min(2).max(2000).optional(),
  version: z.number().int().positive(),
}).strict().refine((value) => value.action !== "REJECT" || value.content === undefined, {
  message: "Rejected suggestions cannot be edited.",
});

export async function PATCH(request: Request, context: RouteContext) {
  if (!(await isTrustedMutationRequest(request))) return apiError("INVALID_ORIGIN", 403);
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return apiError("UNAUTHENTICATED", 401);
  let payload: unknown;
  try { payload = await request.json(); } catch { return apiError("INVALID_JSON", 400); }
  const parsed = reviewSchema.safeParse(payload);
  if (!parsed.success) return apiError("VALIDATION_FAILED", 422, parsed.error.flatten());

  const { suggestionId } = await context.params;
  const correlationId = randomUUID();
  const result = await prisma.$transaction(async (tx) => {
    const suggestion = await tx.memorySuggestion.findFirst({
      where: { id: suggestionId, userId: session.user.id, status: "PENDING", version: parsed.data.version },
      select: { id: true, content: true, sourceRunId: true, evidenceExcerpt: true },
    });
    if (!suggestion) return null;

    const changed = await tx.memorySuggestion.updateMany({
      where: { id: suggestion.id, userId: session.user.id, status: "PENDING", version: parsed.data.version },
      data: {
        status: parsed.data.action === "ACCEPT" ? "ACCEPTED" : "REJECTED",
        reviewedAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (changed.count !== 1) return null;

    let memory = null;
    if (parsed.data.action === "ACCEPT") {
      const content = (parsed.data.content ?? suggestion.content).trim();
      memory = await tx.personalMemory.create({
        data: {
          userId: session.user.id,
          kind: "CONFIRMED",
          content,
          sourceType: "USER_CONFIRMED",
          sourceReference: "AgentRun:" + suggestion.sourceRunId,
          classification: "CONTEXTUAL",
          purpose: "Owner-reviewed explicit response preference",
          confirmedAt: new Date(),
          lastObservedAt: new Date(),
        },
        select: { id: true, kind: true, content: true, sourceType: true, sourceReference: true, confirmedAt: true },
      });
    }

    await tx.auditEvent.create({
      data: {
        actorUserId: session.user.id,
        action: parsed.data.action === "ACCEPT" ? "personal_memory.suggestion_accepted" : "personal_memory.suggestion_rejected",
        targetType: "MemorySuggestion",
        targetId: suggestion.id,
        outcome: "COMPLETED",
        correlationId,
        metadata: { sourceRunId: suggestion.sourceRunId, memoryId: memory?.id ?? null },
      },
    });
    return { status: parsed.data.action === "ACCEPT" ? "ACCEPTED" : "REJECTED", memory };
  });

  if (!result) return apiError("CONFLICT", 409);
  return Response.json({ data: result, correlationId }, { headers: { "Cache-Control": "no-store" } });
}
