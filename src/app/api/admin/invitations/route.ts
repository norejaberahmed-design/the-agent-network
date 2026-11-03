import { createHash, randomBytes, randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import { isTrustedMutationRequest } from "@/lib/request-security";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const invitationSchema = z.object({
  email: z.string().trim().email().max(254).optional(),
  expiresInHours: z.number().int().min(1).max(168).default(72),
});

export async function POST(request: Request) {
  if (!isTrustedMutationRequest(request)) return apiError("INVALID_ORIGIN", 403);

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

  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + parsed.data.expiresInHours * 60 * 60 * 1000);
  const correlationId = randomUUID();

  const invitation = await prisma.$transaction(async (tx) => {
    const created = await tx.invitation.create({
      data: {
        tokenHash,
        intendedEmail: parsed.data.email?.toLowerCase() ?? null,
        expiresAt,
        createdById: session.user.id,
      },
      select: { id: true, intendedEmail: true, expiresAt: true, status: true },
    });

    await tx.auditEvent.create({
      data: {
        actorUserId: session.user.id,
        action: "invitation.created",
        targetType: "Invitation",
        targetId: created.id,
        outcome: "COMPLETED",
        correlationId,
        metadata: { intendedEmail: created.intendedEmail, expiresAt: created.expiresAt.toISOString() },
      },
    });
    return created;
  });

  const baseUrl = process.env.BETTER_AUTH_URL ?? new URL(request.url).origin;
  return Response.json(
    {
      data: {
        ...invitation,
        redemptionUrl: `${baseUrl}/accept-invitation#token=${token}`,
        token,
      },
      correlationId,
      warning: "The invitation token is shown once. Store and share it securely.",
    },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}
