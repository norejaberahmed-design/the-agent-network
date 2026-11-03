import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import { isTrustedMutationRequest } from "@/lib/request-security";
import { prisma } from "@/lib/prisma";
import { projectAgentDisclosure, type AgentDisclosurePolicy } from "@/modules/agents/field-disclosure";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ agentId: string }> };

const lifecycleSchema = z.object({
  status: z.enum(["DRAFT", "ACTIVE", "SUSPENDED"]),
  discoverable: z.boolean(),
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

  const parsed = lifecycleSchema.safeParse(input);
  if (!parsed.success) {
    return apiError("VALIDATION_FAILED", 422, parsed.error.flatten());
  }
  if (parsed.data.status !== "ACTIVE" && parsed.data.discoverable) {
    return apiError("VALIDATION_FAILED", 422);
  }

  const { agentId } = await context.params;
  const result = await prisma.$transaction(async (tx) => {
    const agent = await tx.agent.findUnique({
      where: { id: agentId },
      select: {
        id: true,
        ownerType: true,
        userOwnerId: true,
        organizationOwnerId: true,
        status: true,
        discoverable: true,
        name: true,
        publicDescription: true,
        purpose: true,
        configurationVersion: true,
        fieldPolicies: {
          select: {
            fieldKey: true,
            classification: true,
            publicVisible: true,
            allowedPurposes: true,
            allowedAudiences: true,
          },
        },
      },
    });
    if (!agent) return { state: "NOT_FOUND" as const };

    let ownerId: string;
    if (agent.ownerType === "USER") {
      if (agent.userOwnerId !== session.user.id) {
        return { state: "FORBIDDEN" as const };
      }
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
      if (!membership || (membership.role !== "OWNER" && membership.role !== "ADMIN")) {
        return { state: "FORBIDDEN" as const };
      }
      ownerId = agent.organizationOwnerId;
    }

    if (parsed.data.discoverable) {
      const policies: AgentDisclosurePolicy[] = agent.fieldPolicies
        .filter((policy) =>
          policy.fieldKey === "name" ||
          policy.fieldKey === "publicDescription" ||
          policy.fieldKey === "purpose",
        )
        .map((policy) => ({
          fieldKey: policy.fieldKey as AgentDisclosurePolicy["fieldKey"],
          classification: policy.classification,
          publicVisible: policy.publicVisible,
          allowedPurposes: policy.allowedPurposes,
          allowedAudiences: policy.allowedAudiences,
        }));
      const projection = projectAgentDisclosure(
        {
          id: agent.id,
          name: agent.name,
          publicDescription: agent.publicDescription,
          purpose: agent.purpose,
        },
        policies,
        {
          purpose: "PUBLIC_AGENT_DISCOVERY",
          audience: "PUBLIC_NETWORK",
          ownerApproved: false,
        },
      );
      if (Object.keys(projection.profile).length === 0) {
        return { state: "PUBLIC_PROFILE_REQUIRED" as const };
      }
    }

    if (
      agent.status === parsed.data.status &&
      agent.discoverable === parsed.data.discoverable
    ) {
      return {
        state: "UPDATED" as const,
        status: agent.status,
        discoverable: agent.discoverable,
        configurationVersion: agent.configurationVersion,
      };
    }

    const updated = await tx.agent.updateMany({
      where: {
        id: agentId,
        configurationVersion: agent.configurationVersion,
      },
      data: {
        status: parsed.data.status,
        discoverable: parsed.data.discoverable,
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
        action: "agent.lifecycle.updated",
        targetType: "Agent",
        targetId: agentId,
        outcome: "COMPLETED",
        policyVersion: String(agent.configurationVersion + 1),
        correlationId,
        metadata: {
          previousStatus: agent.status,
          newStatus: parsed.data.status,
          previousDiscoverable: agent.discoverable,
          newDiscoverable: parsed.data.discoverable,
        },
      },
    });

    return {
      state: "UPDATED" as const,
      status: parsed.data.status,
      discoverable: parsed.data.discoverable,
      configurationVersion: agent.configurationVersion + 1,
    };
  });

  if (result.state === "NOT_FOUND") return apiError("NOT_FOUND", 404);
  if (result.state === "FORBIDDEN") return apiError("FORBIDDEN", 403);
  if (result.state === "PUBLIC_PROFILE_REQUIRED") {
    return apiError("PUBLIC_PROFILE_REQUIRED", 422);
  }
  if (result.state === "CONFLICT") return apiError("CONFLICT", 409);

  return Response.json(
    {
      data: {
        id: agentId,
        status: result.status,
        discoverable: result.discoverable,
        configurationVersion: result.configurationVersion,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
