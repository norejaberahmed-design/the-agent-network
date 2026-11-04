import { z } from "zod";

const memoryPurpose = z.string().trim().min(3).max(240);
const memoryContent = z.string().trim().min(2).max(2000);
const sourceReference = z.string().trim().min(1).max(300).optional();

export const createPersonalMemorySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("CONFIRMED"),
    content: memoryContent,
    sourceReference,
    purpose: memoryPurpose,
    classification: z.enum(["PUBLIC", "CONTEXTUAL", "PRIVATE"]).default("CONTEXTUAL"),
  }).strict(),
  z.object({
    kind: z.literal("TASK_CONTEXT"),
    content: memoryContent,
    sourceReference,
    purpose: memoryPurpose,
    classification: z.enum(["PUBLIC", "CONTEXTUAL", "PRIVATE"]).default("CONTEXTUAL"),
    taskContextRunId: z.string().trim().min(1).max(64),
    expiresAt: z.string().datetime(),
  }).strict(),
]);

export const updatePersonalMemorySchema = z.object({
  content: memoryContent.optional(),
  confirm: z.literal(true).optional(),
  status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one change is required");

export type CreatePersonalMemoryInput = z.infer<typeof createPersonalMemorySchema>;
