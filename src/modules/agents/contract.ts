import { z } from "zod";

export const createAgentSchema = z.object({
  name: z.string().trim().min(2).max(80),
  purpose: z.string().trim().min(10).max(500),
  publicDescription: z.string().trim().max(500).optional(),
  primaryLanguage: z.enum(["ar", "en"]).default("ar"),
});

export type CreateAgentInput = z.infer<typeof createAgentSchema>;
