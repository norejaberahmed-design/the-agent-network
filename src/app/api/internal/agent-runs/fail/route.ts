import { z } from "zod";
import { apiError } from "@/lib/api-response";
import { isAuthorizedAgentWorker, readBoundedWorkerJson } from "@/lib/worker-auth";
import { failAgentRun } from "@/modules/runtime/worker";

export const runtime = "nodejs";

const schema = z.object({
  runId: z.string().min(1).max(64),
  workerId: z.string().regex(/^[A-Za-z0-9._:-]{3,64}$/),
  errorCode: z.enum(["PROVIDER_UNAVAILABLE", "INVALID_INPUT", "WORKER_FAILURE"]),
  retryable: z.boolean(),
}).strict();

export async function POST(request: Request) {
  if (!isAuthorizedAgentWorker(request)) return apiError("UNAUTHENTICATED", 401);
  const decoded = await readBoundedWorkerJson(request);
  if (!decoded.ok) return apiError("INVALID_JSON", 400);
  const body = decoded.value;
  const parsed = schema.safeParse(body);
  if (!parsed.success) return apiError("VALIDATION_FAILED", 422);
  const status = await failAgentRun(
    parsed.data.runId,
    parsed.data.workerId,
    parsed.data.errorCode,
    parsed.data.retryable,
  );
  if (!status) return apiError("CONFLICT", 409);
  return Response.json({ data: { runId: parsed.data.runId, status } }, {
    headers: { "Cache-Control": "no-store" },
  });
}
