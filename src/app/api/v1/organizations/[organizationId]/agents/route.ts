import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import { isTrustedMutationRequest } from "@/lib/request-security";
import { prisma } from "@/lib/prisma";
import { createAgentSchema } from "@/modules/agents/contract";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ organizationId: string }> };

async function getMembership(organizationId: string, userId: string) {
  return prisma.membership.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: { role: true },
  });
}

export async function GET(_request: Request, context: RouteContext) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return apiError("UNAUTHENTICATED", 401);

  const { organizationId } = await context.params;
  const membership = await getMembership(organizationId, session.user.id);
  if (!membership) return apiError("FORBIDDEN", 403);

  const agents = await prisma.agent.findMany({
    where: { ownerType: "ORGANIZATION", organizationOwnerId: organizationId },
    select: {
      id: true,
      name: true,
      purpose: true,
      publicDescription: true,
      primaryLanguage: true,
      supportedLanguages: true,
      discoverable: true,
      status: true,
      configurationVersion: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return Response.json({ data: agents }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, context: RouteContext) {
  if (!isTrustedMutationRequest(request)) return apiError("INVALID_ORIGIN", 403);
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return apiError("UNAUTHENTICATED", 401);

  const { organizationId } = await context.params;
  const membership = await getMembership(organizationId, session.user.id);
  if (!membership || (membership.role !== "OWNER" && membership.role !== "ADMIN" && membership.role !== "AGENT_MANAGER")) {
    return apiError("FORBIDDEN", 403);
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return apiError("INVALID_JSON", 400);
  }

  const parsed = createAgentSchema.safeParse(input);
  if (!parsed.success) return apiError("VALIDATION_FAILED", 422, parsed.error.flatten());

  const correlationId = randomUUID();
  const { name, purpose, publicDescription, primaryLanguage } = parsed.data;

  const agent = await prisma.$transaction(async (tx) => {
    const created = await tx.agent.create({
      data: {
        ownerType: "ORGANIZATION",
        organizationOwnerId: organizationId,
        name,
        purpose,
        publicDescription: publicDescription || null,
        primaryLanguage,
        supportedLanguages: ["ar", "en"],
        discoverable: false,
        status: "DRAFT",
      },
      select: {
        id: true,
        name: true,
        purpose: true,
        publicDescription: true,
        primaryLanguage: true,
        supportedLanguages: true,
        discoverable: true,
        status: true,
        configurationVersion: true,
        createdAt: true,
      },
    });

    await tx.agentFieldPolicy.createMany({
      data: [
        {
          agentId: created.id,
          fieldKey: "name",
          classification: "PUBLIC",
          publicVisible: false,
          allowedPurposes: [],
          allowedAudiences: [],
        },
        {
          agentId: created.id,
          fieldKey: "publicDescription",
          classification: "PUBLIC",
          publicVisible: false,
          allowedPurposes: [],
          allowedAudiences: [],
        },
        {
          agentId: created.id,
          fieldKey: "purpose",
          classification: "PRIVATE",
          publicVisible: false,
          allowedPurposes: [],
          allowedAudiences: [],
        },
      ],
    });

    await tx.auditEvent.create({
      data: {
        actorUserId: session.user.id,
        agentId: created.id,
        ownerType: "ORGANIZATION",
        ownerId: organizationId,
        action: "agent.created",
        targetType: "Agent",
        targetId: created.id,
        outcome: "COMPLETED",
        policyVersion: "1",
        correlationId,
        metadata: { initialStatus: "DRAFT", discoverable: false },
      },
    });

    return created;
  });

  return Response.json(
    { data: agent, correlationId },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}
