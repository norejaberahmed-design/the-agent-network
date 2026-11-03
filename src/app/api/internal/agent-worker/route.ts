import { timingSafeEqual, randomUUID } from "node:crypto";
import { apiError } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { OpenAIResponsesPlanProvider, OpenAITextModerator } from "@/modules/runtime/openai-provider";
import { runAgentWorkerOnce } from "@/modules/runtime/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validWorkerSecret(request: Request): boolean {
  const expected = process.env.AGENT_WORKER_SECRET;
  const authorization = request.headers.get("authorization") ?? "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!expected || expected.length < 32 || !supplied) return false;
  const expectedBytes = Buffer.from(expected, "utf8");
  const suppliedBytes = Buffer.from(supplied, "utf8");
  if (expectedBytes.length !== suppliedBytes.length) return false;
  return timingSafeEqual(expectedBytes, suppliedBytes);
}

export async function POST(request: Request) {
  if (!validWorkerSecret(request)) return apiError("UNAUTHENTICATED", 401);

  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_AGENT_MODEL;
  if (!apiKey || !model) return apiError("WORKER_DISABLED", 503);

  try {
    const result = await runAgentWorkerOnce({
      prisma,
      provider: new OpenAIResponsesPlanProvider(apiKey, model),
      moderator: new OpenAITextModerator(apiKey),
      workerId: randomUUID(),
    });
    if (result.status === "DISABLED") return apiError("WORKER_DISABLED", 503);
    if (result.status === "THROTTLED") return apiError("WORKER_DAILY_LIMIT", 429);
    return Response.json({ data: result }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return apiError("WORKER_FAILED", 500);
  }
}
