import { describe, expect, it } from "vitest";
import { createAgentSchema } from "./contract";

describe("createAgentSchema", () => {
  it("accepts a valid Arabic-first agent", () => {
    const result = createAgentSchema.safeParse({
      name: "مساعدي المهني",
      purpose: "يساعدني في اكتشاف الفرص المهنية المناسبة لي.",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.primaryLanguage).toBe("ar");
    }
  });

  it("rejects too-short names and purposes", () => {
    expect(
      createAgentSchema.safeParse({ name: "A", purpose: "short" }).success,
    ).toBe(false);
  });

  it("rejects an unsupported language", () => {
    expect(
      createAgentSchema.safeParse({
        name: "Research Agent",
        purpose: "Research public information with sources.",
        primaryLanguage: "fr",
      }).success,
    ).toBe(false);
  });

  it("does not allow a public discoverability flag from client input", () => {
    const result = createAgentSchema.safeParse({
      name: "Private Agent",
      purpose: "A private owner-controlled agent.",
      discoverable: true,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect("discoverable" in result.data).toBe(false);
    }
  });
});
