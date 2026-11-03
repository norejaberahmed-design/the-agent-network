import { describe, expect, it } from "vitest";
import { upsertFieldPolicySchema } from "./field-policy-contract";

describe("upsertFieldPolicySchema", () => {
  it("accepts a private field that is not publicly visible", () => {
    const result = upsertFieldPolicySchema.safeParse({
      fieldKey: "purpose",
      classification: "PRIVATE",
      publicVisible: false,
      allowedPurposes: ["private-agent-configuration"],
      allowedAudiences: ["owner"],
      retentionDays: 365,
    });
    expect(result.success).toBe(true);
  });

  it("rejects public visibility for contextual and sensitive data", () => {
    for (const classification of ["CONTEXTUAL", "PRIVATE", "HIGHLY_SENSITIVE"] as const) {
      const result = upsertFieldPolicySchema.safeParse({
        fieldKey: "purpose",
        classification,
        publicVisible: true,
      });
      expect(result.success).toBe(false);
    }
  });

  it("rejects unsupported field names and excessive retention", () => {
    expect(upsertFieldPolicySchema.safeParse({
      fieldKey: "password",
      classification: "PRIVATE",
      publicVisible: false,
    }).success).toBe(false);
    expect(upsertFieldPolicySchema.safeParse({
      fieldKey: "name",
      classification: "PUBLIC",
      publicVisible: false,
      retentionDays: 4000,
    }).success).toBe(false);
  });
});
