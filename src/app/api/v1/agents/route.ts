import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import { isTrustedMutationRequest } from "@/lib/request-security";
import { prisma } from "@/lib/prisma";
import { createAgentSchema } from "@/modules/agents/contract";

export const runtime = "nodejs";

async function getAuthenticatedUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user ?? null;
}

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return apiError("UNAUTHENTICATED", 401);

  const agents = await prisma.agent.findMany({
    where: { ownerType: "USER", userOwnerId: user.id },
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

  return Response.json(
    { data: agents },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  if (!isTrustedMutationRequest(request)) return apiError("INVALID_ORIGIN", 403);

  const user = await getAuthenticatedUser();
  if (!user) return apiError("UNAUTHENTICATED", 401);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return apiError("INVALID_JSON", 400);
  }

  const parsed = createAgentSchema.safeParse(payload);
  if (!parsed.success) {
    return apiError("VALIDATION_FAILED", 422, parsed.error.flatten());
  }

  const correlationId = randomUUID();
  const { name, purpose, publicDescription, primaryLanguage } = parsed.data;

  const agent = await prisma.$transaction(async (tx) => {
    const created = await tx.agent.create({
      data: {
        ownerType: "USER",
        userOwnerId: user.id,
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

    await tx.auditEvent.create({
      data: {
        actorUserId: user.id,
        agentId: created.id,
        ownerType: "USER",
        ownerId: user.id,
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
