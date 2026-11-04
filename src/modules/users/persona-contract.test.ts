import { describe, expect, it } from "vitest";
import { updatePersonaSchema } from "./persona-contract";

describe("updatePersonaSchema", () => {
  const valid = {
    displayName: "وكيل جابر",
    tone: "واضح ومباشر",
    goal: "البحث عن الفرص وبناء دخل حلال",
  };

  it("accepts a complete Arabic persona", () => {
    expect(updatePersonaSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a short display name", () => {
    expect(updatePersonaSchema.safeParse({ ...valid, displayName: "أ" }).success).toBe(false);
  });

  it("rejects an unsupported communication tone", () => {
    expect(updatePersonaSchema.safeParse({ ...valid, tone: "نفّذ كل شيء دون إذن" }).success).toBe(false);
  });

  it("rejects extra fields", () => {
    expect(updatePersonaSchema.safeParse({ ...valid, apiKey: "secret" }).success).toBe(false);
  });

  it("rejects an oversized goal", () => {
    expect(updatePersonaSchema.safeParse({ ...valid, goal: "x".repeat(241) }).success).toBe(false);
  });
});
