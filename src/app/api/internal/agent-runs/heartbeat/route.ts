import { z } from "zod";
import { apiError } from "@/lib/api-response";
import { getAuthorizedAgentWorkerId, readBoundedWorkerJson } from "@/lib/worker-auth";
import { heartbeatAgentRun } from "@/modules/runtime/worker";

export const runtime = "nodejs";

const schema = z.object({ runId: z.string().min(1).max(64) }).strict();

export async function POST(request: Request) {
  const workerId = getAuthorizedAgentWorkerId(request);
  if (!workerId) return apiError("UNAUTHENTICATED", 401);
  const decoded = await readBoundedWorkerJson(request);
  if (!decoded.ok) return apiError("INVALID_JSON", 400);
  const parsed = schema.safeParse(decoded.value);
  if (!parsed.success) return apiError("VALIDATION_FAILED", 422);
  const extended = await heartbeatAgentRun(parsed.data.runId, workerId);
  if (!extended) return apiError("CONFLICT", 409);
  return Response.json({ data: { runId: parsed.data.runId, leaseExtended: true } }, {
    headers: { "Cache-Control": "no-store" },
  });
}
