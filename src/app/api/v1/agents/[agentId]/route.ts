import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import { isTrustedMutationRequest } from "@/lib/request-security";
import { prisma } from "@/lib/prisma";
import { organizationAgentPermissions } from "@/modules/agents/access-policy";
import { lockAgentRuntime } from "@/modules/runtime/locks";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ agentId: string }> };

const profileSchema = z.object({
  configurationVersion: z.number().int().min(1),
  name: z.string().trim().min(2).max(100).optional(),
  purpose: z.string().trim().min(3).max(1000).optional(),
  publicDescription: z.string().trim().max(500).nullable().optional(),
  primaryLanguage: z.enum(["ar", "en"]).optional(),
  supportedLanguages: z.array(z.enum(["ar", "en"])).min(1).max(2).optional(),
}).strict().refine(
  (value) => Object.keys(value).some((key) => key !== "configurationVersion"),
  { message: "At least one profile field must be provided." },
);

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

  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) {
    return apiError("VALIDATION_FAILED", 422, parsed.error.flatten());
  }

  const { agentId } = await context.params;
  const { configurationVersion, ...profile } = parsed.data;
  if (
    profile.primaryLanguage &&
    profile.supportedLanguages &&
    !profile.supportedLanguages.includes(profile.primaryLanguage)
  ) {
    return apiError("VALIDATION_FAILED", 422);
  }

  const result = await prisma.$transaction(async (tx) => {
    await lockAgentRuntime(tx, agentId);

    const agent = await tx.agent.findUnique({
      where: { id: agentId },
      select: {
        id: true,
        ownerType: true,
        userOwnerId: true,
        organizationOwnerId: true,
        status: true,
        primaryLanguage: true,
        supportedLanguages: true,
        configurationVersion: true,
      },
    });
    if (!agent) return { state: "NOT_FOUND" as const };

    let ownerId: string;
    if (agent.ownerType === "USER") {
      if (agent.userOwnerId !== session.user.id) return { state: "FORBIDDEN" as const };
      ownerId = session.user.id;
    } else {
      if (!agent.organizationOwnerId) return { state: "FORBIDDEN" as const };
      const membership = await tx.membership.findUnique({
        where: {
          organizationId_userId: {
            organizationId: agent.organizationOwnerId,
            userId: session.user.id,
          },
        },
        select: { role: true },
      });
      if (!membership || !organizationAgentPermissions(membership.role).canManage) {
        return { state: "FORBIDDEN" as const };
      }
      ownerId = agent.organizationOwnerId;
    }

    if (agent.status === "REVOKED") return { state: "TERMINAL" as const };
    if (agent.configurationVersion !== configurationVersion) {
      return { state: "CONFLICT" as const };
    }

    const effectivePrimaryLanguage = profile.primaryLanguage ?? agent.primaryLanguage;
    const effectiveSupportedLanguages = profile.supportedLanguages ?? agent.supportedLanguages;
    if (!effectiveSupportedLanguages.includes(effectivePrimaryLanguage)) {
      return { state: "INVALID_LANGUAGE_CONFIGURATION" as const };
    }

    const inFlight = await tx.agentRun.count({
      where: { agentId, status: { in: ["QUEUED", "PLANNING"] } },
    });
    if (inFlight > 0) return { state: "RUNS_IN_PROGRESS" as const };

    const updated = await tx.agent.updateMany({
      where: { id: agentId, configurationVersion },
      data: {
        ...profile,
        configurationVersion: { increment: 1 },
      },
    });
    if (updated.count !== 1) return { state: "CONFLICT" as const };

    const correlationId = randomUUID();
    await tx.auditEvent.create({
      data: {
        actorUserId: session.user.id,
        agentId,
        ownerType: agent.ownerType,
        ownerId,
        action: "agent.profile.updated",
        targetType: "Agent",
        targetId: agentId,
        outcome: "COMPLETED",
        policyVersion: String(configurationVersion + 1),
        correlationId,
        metadata: { changedFields: Object.keys(profile) },
      },
    });

    const saved = await tx.agent.findUniqueOrThrow({
      where: { id: agentId },
      select: {
        id: true,
        name: true,
        purpose: true,
        publicDescription: true,
        primaryLanguage: true,
        supportedLanguages: true,
        status: true,
        discoverable: true,
        configurationVersion: true,
        updatedAt: true,
      },
    });
    return { state: "UPDATED" as const, agent: saved, correlationId };
  });

  if (result.state === "NOT_FOUND") return apiError("NOT_FOUND", 404);
  if (result.state === "FORBIDDEN") return apiError("FORBIDDEN", 403);
  if (result.state === "TERMINAL") return apiError("CONFLICT", 409);
  if (result.state === "INVALID_LANGUAGE_CONFIGURATION") return apiError("VALIDATION_FAILED", 422);
  if (result.state === "CONFLICT") return apiError("VERSION_CONFLICT", 409);
  if (result.state === "RUNS_IN_PROGRESS") return apiError("AGENT_RUNS_IN_PROGRESS", 409);

  return Response.json(
    { data: result.agent, correlationId: result.correlationId },
    { headers: { "Cache-Control": "no-store" } },
  );
}
