import { z } from "zod";

export const upsertFieldPolicySchema = z.object({
  fieldKey: z.enum(["name", "publicDescription", "purpose"]),
  classification: z.enum(["PUBLIC", "CONTEXTUAL", "PRIVATE", "HIGHLY_SENSITIVE"]),
  publicVisible: z.boolean().default(false),
  allowedPurposes: z.array(z.string().trim().min(2).max(120)).max(10).default([]),
  allowedAudiences: z.array(z.string().trim().min(2).max(120)).max(10).default([]),
  retentionDays: z.number().int().min(1).max(3650).nullable().optional(),
}).superRefine((value, context) => {
  if (value.publicVisible && value.classification !== "PUBLIC") {
    context.addIssue({
      code: "custom",
      path: ["publicVisible"],
      message: "Only PUBLIC fields can be publicly visible.",
    });
  }
});
