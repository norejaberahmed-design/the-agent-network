import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({
      status: "ready",
      checks: { database: "ok" },
      timestamp: new Date().toISOString(),
    });
  } catch {
    return Response.json(
      {
        status: "not_ready",
        checks: { database: "failed" },
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
