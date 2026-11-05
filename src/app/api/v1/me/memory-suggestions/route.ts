import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return apiError("UNAUTHENTICATED", 401);
  const suggestions = await prisma.memorySuggestion.findMany({
    where: {
      userId: session.user.id,
      status: "PENDING",
    },
    select: {
      id: true,
      content: true,
      evidenceExcerpt: true,
      confidence: true,
      status: true,
      version: true,
      createdAt: true,
      sourceRun: { select: { id: true, createdAt: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return Response.json({ data: suggestions }, { headers: { "Cache-Control": "no-store" } });
}
