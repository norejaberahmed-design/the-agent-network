import { createHash } from "node:crypto";
import { z } from "zod";

export const createAgentRunSchema = z.object({
  task: z.string().trim().min(1).max(4000),
  purpose: z.string().trim().min(10).max(300),
  target: z.string().trim().min(3).max(128).refine(
    (value) => !value.includes("*") && !value.includes("?"),
    "Wildcards are not allowed.",
  ),
  idempotencyKey: z.string().trim().min(16).max(128).regex(/^[A-Za-z0-9._:-]+$/),
}).strict();

export type CreateAgentRunInput = z.infer<typeof createAgentRunSchema>;

export function digestAgentRunRequest(input: CreateAgentRunInput, agentId: string): string {
  const canonical = JSON.stringify({
    agentId,
    task: input.task,
    purpose: input.purpose,
    target: input.target,
  });
  return createHash("sha256").update(canonical).digest("hex");
}
