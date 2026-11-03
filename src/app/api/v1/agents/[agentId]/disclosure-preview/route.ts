import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { getAgentAccess } from "@/modules/agents/access";
import {
  projectAgentDisclosure,
  type AgentDisclosureFieldKey,
  type AgentDisclosurePolicy,
} from "@/modules/agents/field-disclosure";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ agentId: string }> };

const supportedFields = new Set<AgentDisclosureFieldKey>([
  "name",
  "publicDescription",
  "purpose",
]);

export async function GET(_request: Request, context: RouteContext) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return apiError("UNAUTHENTICATED", 401);

  const { agentId } = await context.params;
  const access = await getAgentAccess(agentId, session.user.id);
  if (!access?.canManageFieldPolicies) return apiError("FORBIDDEN", 403);

  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: {
      id: true,
      name: true,
      publicDescription: true,
      purpose: true,
      status: true,
      discoverable: true,
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
  if (!agent) return apiError("NOT_FOUND", 404);

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

  return Response.json(
    {
      data: {
        ...projection,
        status: agent.status,
        discoverable: agent.discoverable,
        readyForPublicDiscovery:
          agent.status === "ACTIVE" && agent.discoverable,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
