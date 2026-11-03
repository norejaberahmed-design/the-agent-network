import { z } from "zod";

export const createPermissionGrantSchema = z.object({
  purpose: z.string().trim().min(10).max(300),
  actionScope: z.array(z.enum(["DISCOVER_INTERNAL", "SEARCH_PUBLIC_WEB"])).min(1).max(2),
  targetScope: z.array(z.string().trim().min(3).max(128).refine((value) => !value.includes("*") && !value.includes("?"), "Wildcards are not allowed in target scopes.")).min(1).max(10),
  dataScope: z.array(z.enum(["PUBLIC_PROFILE", "OWNER_APPROVED_CONTEXTUAL"])).min(1).max(2),
  expiresAt: z.string().datetime(),
  maxUses: z.number().int().min(1).max(10000).optional(),
});

export type CreatePermissionGrantInput = z.infer<typeof createPermissionGrantSchema>;

export function isSafePublicDisclosure(
  classification: "PUBLIC" | "CONTEXTUAL" | "PRIVATE" | "HIGHLY_SENSITIVE",
  publicVisible: boolean,
) {
  return !publicVisible || classification === "PUBLIC";
}
