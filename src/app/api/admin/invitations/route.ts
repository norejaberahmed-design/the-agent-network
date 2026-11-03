
import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import { isTrustedMutationRequest } from "@/lib/request-security";
import { prisma } from "@/lib/prisma";
import { issueInvitation } from "@/modules/invitations/issue-invitation";

export const runtime = "nodejs";

const invitationSchema = z.object({
  email: z.string().trim().email().max(254).optional(),
  expiresInHours: z.number().int().min(1).max(168).default(72),
  organizationId: z.string().trim().min(1).optional(),
  role: z.enum(["ADMIN", "AGENT_MANAGER", "OPERATOR", "AUDITOR", "VIEWER"]).optional(),
}).superRefine((value, context) => {
  if (Boolean(value.organizationId) !== Boolean(value.role)) {
    context.addIssue({
      code: "custom",
      path: ["role"],
      message: "An organization invitation must include exactly one membership role.",
    });
  }
});

export async function POST(request: Request) {
  if (!(await isTrustedMutationRequest(request))) return apiError("INVALID_ORIGIN", 403);

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return apiError("UNAUTHENTICATED", 401);
  }

  const actor = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { platformRole: true },
  });
  if (actor?.platformRole !== "PLATFORM_ADMIN") {
    return apiError("FORBIDDEN", 403);
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return apiError("INVALID_JSON", 400);
  }

  const parsed = invitationSchema.safeParse(input);
  if (!parsed.success) {
    return apiError("VALIDATION_FAILED", 422, parsed.error.flatten());
  }

  if (parsed.data.organizationId) {
    const organization = await prisma.organization.findUnique({
      where: { id: parsed.data.organizationId },
      select: { id: true },
    });
    if (!organization) return apiError("NOT_FOUND", 404);
  }

  const issued = await issueInvitation({
    createdById: session.user.id,
    email: parsed.data.email,
    expiresInHours: parsed.data.expiresInHours,
    organizationId: parsed.data.organizationId,
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
