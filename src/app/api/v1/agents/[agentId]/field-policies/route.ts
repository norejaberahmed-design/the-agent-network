import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import { isTrustedMutationRequest } from "@/lib/request-security";
import { prisma } from "@/lib/prisma";
import { getAgentAccess } from "@/modules/agents/access";
import { upsertFieldPolicySchema } from "@/modules/agents/field-policy-contract";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ agentId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return apiError("UNAUTHENTICATED", 401);

  const { agentId } = await context.params;
  const access = await getAgentAccess(agentId, session.user.id);
  if (!access?.canViewFieldPolicies) return apiError("FORBIDDEN", 403);

  const policies = await prisma.agentFieldPolicy.findMany({
    where: { agentId },
    select: {
      id: true,
      fieldKey: true,
      classification: true,
      publicVisible: true,
      allowedPurposes: true,
      allowedAudiences: true,
      retentionDays: true,
      policyVersion: true,
      updatedAt: true,
    },
    orderBy: { fieldKey: "asc" },
  });

  return Response.json({ data: policies }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, context: RouteContext) {
  if (!isTrustedMutationRequest(request)) return apiError("INVALID_ORIGIN", 403);
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return apiError("UNAUTHENTICATED", 401);

  const { agentId } = await context.params;
  const access = await getAgentAccess(agentId, session.user.id);
  if (!access?.canManage) return apiError("FORBIDDEN", 403);

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return apiError("INVALID_JSON", 400);
  }

  const parsed = upsertFieldPolicySchema.safeParse(input);
  if (!parsed.success) return apiError("VALIDATION_FAILED", 422, parsed.error.flatten());

  const correlationId = randomUUID();
  const policy = await prisma.$transaction(async (tx) => {
    const current = await tx.agentFieldPolicy.findUnique({
      where: { agentId_fieldKey: { agentId, fieldKey: parsed.data.fieldKey } },
      select: { policyVersion: true },
    });

    const saved = await tx.agentFieldPolicy.upsert({
      where: { agentId_fieldKey: { agentId, fieldKey: parsed.data.fieldKey } },
      create: {
        agentId,
        ...parsed.data,
        policyVersion: 1,
      },
      update: {
        ...parsed.data,
        policyVersion: { increment: 1 },
      },
      select: {
        id: true,
        fieldKey: true,
        classification: true,
        publicVisible: true,
        allowedPurposes: true,
        allowedAudiences: true,
        retentionDays: true,
        policyVersion: true,
        updatedAt: true,
      },
    });

    await tx.agent.update({
      where: { id: agentId },
      data: { configurationVersion: { increment: 1 } },
    });

    await tx.auditEvent.create({
      data: {
        actorUserId: session.user.id,
        agentId,
        ownerType: access.ownerType,
        ownerId: access.ownerId,
        action: "agent.field_policy.updated",
        targetType: "AgentFieldPolicy",
        targetId: saved.id,
        outcome: "COMPLETED",
        policyVersion: String(saved.policyVersion),
        correlationId,
        metadata: {
          fieldKey: saved.fieldKey,
          classification: saved.classification,
          publicVisible: saved.publicVisible,
          previousVersion: current?.policyVersion ?? null,
        },
      },
    });
    return saved;
  });

  return Response.json(
    { data: policy, correlationId },
    { headers: { "Cache-Control": "no-store" } },
  );
}
