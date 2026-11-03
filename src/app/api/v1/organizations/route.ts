import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import { isTrustedMutationRequest } from "@/lib/request-security";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const createOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(120),
});

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return apiError("UNAUTHENTICATED", 401);

  const memberships = await prisma.membership.findMany({
    where: { userId: session.user.id },
    select: {
      role: true,
      createdAt: true,
      organization: {
        select: { id: true, name: true, slug: true, createdAt: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return Response.json(
    { data: memberships },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  if (!isTrustedMutationRequest(request)) return apiError("INVALID_ORIGIN", 403);
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return apiError("UNAUTHENTICATED", 401);

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return apiError("INVALID_JSON", 400);
  }

  const parsed = createOrganizationSchema.safeParse(input);
  if (!parsed.success) return apiError("VALIDATION_FAILED", 422, parsed.error.flatten());

  const correlationId = randomUUID();
  const organization = await prisma.$transaction(async (tx) => {
    const created = await tx.organization.create({
      data: {
        name: parsed.data.name,
        slug: `org-${randomUUID().slice(0, 12)}`,
      },
      select: { id: true, name: true, slug: true, createdAt: true },
    });

    await tx.membership.create({
      data: {
        organizationId: created.id,
        userId: session.user.id,
        role: "OWNER",
      },
    });

    await tx.auditEvent.create({
      data: {
        actorUserId: session.user.id,
        ownerType: "ORGANIZATION",
        ownerId: created.id,
        action: "organization.created",
        targetType: "Organization",
        targetId: created.id,
        outcome: "COMPLETED",
        correlationId,
      },
    });

    return created;
  });

  return Response.json(
    { data: { ...organization, role: "OWNER" }, correlationId },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}
