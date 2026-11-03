export const runtime = "nodejs";

export function GET() {
  return Response.json({
    status: "alive",
    service: "the-agent-network",
    timestamp: new Date().toISOString(),
  });
}
