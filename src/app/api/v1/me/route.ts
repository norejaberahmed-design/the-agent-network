import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import { isTrustedMutationRequest } from "@/lib/request-security";
import { prisma } from "@/lib/prisma";
import { updateProfileSchema } from "@/modules/users/profile-contract";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return apiError("UNAUTHENTICATED", 401);

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true, image: true, createdAt: true },
  });
  if (!user) return apiError("UNAUTHENTICATED", 401);

  return Response.json({ data: user }, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function PATCH(request: Request) {
  if (!(await isTrustedMutationRequest(request))) return apiError("INVALID_ORIGIN", 403);

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return apiError("UNAUTHENTICATED", 401);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return apiError("INVALID_JSON", 400);
  }

  const parsed = updateProfileSchema.safeParse(payload);
  if (!parsed.success) return apiError("VALIDATION_FAILED", 422, parsed.error.flatten());

  const correlationId = randomUUID();
  const updated = await prisma.$transaction(async (tx) => {
    const current = await tx.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, name: true, email: true, image: true, createdAt: true },
    });
    if (!current) throw new Error("PROFILE_USER_NOT_FOUND");

    if (current.name === parsed.data.name) return current;

    const user = await tx.user.update({
      where: { id: session.user.id },
      data: { name: parsed.data.name },
      select: { id: true, name: true, email: true, image: true, createdAt: true },
    });

    await tx.auditEvent.create({
      data: {
        actorUserId: session.user.id,
        action: "user.profile.updated",
        targetType: "User",
        targetId: session.user.id,
        outcome: "COMPLETED",
        correlationId,
        metadata: { changedFields: ["name"] },
      },
    });

    return user;
  }).catch((error: unknown) => {
    if (error instanceof Error && error.message === "PROFILE_USER_NOT_FOUND") return null;
    throw error;
  });

  if (!updated) return apiError("UNAUTHENTICATED", 401);

  return Response.json(
    { data: updated, correlationId },
    { headers: { "Cache-Control": "no-store" } },
  );
}
