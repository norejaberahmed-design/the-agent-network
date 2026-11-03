import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import { isTrustedMutationRequest } from "@/lib/request-security";
import { prisma } from "@/lib/prisma";
import { issueInvitation } from "@/modules/invitations/issue-invitation";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ organizationId: string }> };

const organizationInvitationSchema = z.object({
  email: z.string().trim().email().max(254),
  role: z.enum(["ADMIN", "AGENT_MANAGER", "OPERATOR", "AUDITOR", "VIEWER"]),
  expiresInHours: z.number().int().min(1).max(168).default(72),
});

export async function POST(request: Request, context: RouteContext) {
  if (!(await isTrustedMutationRequest(request))) return apiError("INVALID_ORIGIN", 403);

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return apiError("UNAUTHENTICATED", 401);

  const { organizationId } = await context.params;
  const actorMembership = await prisma.membership.findUnique({
    where: {
      organizationId_userId: {
        organizationId,
        userId: session.user.id,
      },
    },
    select: { role: true },
  });

  if (
    !actorMembership ||
    (actorMembership.role !== "OWNER" && actorMembership.role !== "ADMIN")
  ) {
    return apiError("FORBIDDEN", 403);
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return apiError("INVALID_JSON", 400);
  }

  const parsed = organizationInvitationSchema.safeParse(input);
  if (!parsed.success) {
    return apiError("VALIDATION_FAILED", 422, parsed.error.flatten());
  }

  if (actorMembership.role === "ADMIN" && parsed.data.role === "ADMIN") {
    return apiError("FORBIDDEN", 403);
  }

  const issued = await issueInvitation({
    createdById: session.user.id,
    email: parsed.data.email,
    expiresInHours: parsed.data.expiresInHours,
    organizationId,
    role: parsed.data.role,
  });

  const baseUrl = process.env.BETTER_AUTH_URL ?? new URL(request.url).origin;
  return Response.json(
    {
      data: {
        ...issued.invitation,
        redemptionUrl: `${baseUrl}/accept-invitation#token=${issued.token}`,
        token: issued.token,
      },
      correlationId: issued.correlationId,
      warning: "The invitation token is shown once. Store and share it securely.",
    },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}
