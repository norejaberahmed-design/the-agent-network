import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import {
  projectAgentDisclosure,
  type AgentDisclosureFieldKey,
  type AgentDisclosurePolicy,
} from "@/modules/agents/field-disclosure";

export const runtime = "nodejs";

const supportedFields = new Set<AgentDisclosureFieldKey>([
  "name",
  "publicDescription",
  "purpose",
]);

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return apiError("UNAUTHENTICATED", 401);

  const cursor = new URL(request.url).searchParams.get("cursor") ?? undefined;
  if (cursor && cursor.length > 128) return apiError("VALIDATION_FAILED", 422);

  const agents = await prisma.agent.findMany({
      where: {
        status: "ACTIVE",
        discoverable: true,
      },
      select: {
        id: true,
        name: true,
        publicDescription: true,
        purpose: true,
        createdAt: true,
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
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 20,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    }).catch(() => null);
  if (!agents) return apiError("VALIDATION_FAILED", 422);

  const data = agents.flatMap((agent) => {
    const policies: AgentDisclosurePolicy[] = agent.fieldPolicies
      .filter((policy) => supportedFields.has(policy.fieldKey as AgentDisclosureFieldKey))
      .map((policy) => ({
        fieldKey: policy.fieldKey as AgentDisclosureFieldKey,
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

    if (Object.keys(projection.profile).length === 0) return [];
    return [{
      id: projection.id,
      profile: projection.profile,
    }];
  });

  return Response.json(
    {
      data,
      nextCursor: agents.length === 20 ? agents[agents.length - 1].id : null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
