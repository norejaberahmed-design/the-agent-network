import { z } from "zod";
import { apiError } from "@/lib/api-response";
import { isAuthorizedAgentWorker } from "@/lib/worker-auth";
import { claimNextAgentRun } from "@/modules/runtime/worker";

export const runtime = "nodejs";

const schema = z.object({
  workerId: z.string().regex(/^[A-Za-z0-9._:-]{3,64}$/),
}).strict();

export async function POST(request: Request) {
  if (!isAuthorizedAgentWorker(request)) return apiError("UNAUTHENTICATED", 401);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", 400);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return apiError("VALIDATION_FAILED", 422);
  try {
    const run = await claimNextAgentRun(parsed.data.workerId);
    return Response.json(
      { data: run, claimed: Boolean(run), planningEnabled: false, executionEnabled: false },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return apiError("INTERNAL_ERROR", 500);
  }
}
