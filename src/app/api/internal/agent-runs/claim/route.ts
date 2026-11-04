import { apiError } from "@/lib/api-response";
import { getAuthorizedAgentWorkerId } from "@/lib/worker-auth";
import { claimNextAgentRun } from "@/modules/runtime/worker";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const workerId = getAuthorizedAgentWorkerId(request);
  if (!workerId) return apiError("UNAUTHENTICATED", 401);
  try {
    const run = await claimNextAgentRun(workerId);
    return Response.json(
      { data: run, claimed: Boolean(run), planningEnabled: false, executionEnabled: false },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return apiError("INTERNAL_ERROR", 500);
  }
}
