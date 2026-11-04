import { z } from "zod";

export const personaToneSchema = z.enum([
  "واضح ومباشر",
  "رسمي واحترافي",
  "ودود ومقنع",
  "تحليلي ودقيق",
]);

export const updatePersonaSchema = z.object({
  displayName: z.string().trim().min(2).max(60),
  tone: personaToneSchema,
  goal: z.string().trim().min(3).max(240),
  memoryContextEnabled: z.boolean().optional(),
}).strict();

export type UpdatePersonaInput = z.infer<typeof updatePersonaSchema>;
