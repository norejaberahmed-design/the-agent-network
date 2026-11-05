import { describe, expect, it } from "vitest";
import { extractExplicitMemorySuggestions } from "./suggestion-extractor";

describe("extractExplicitMemorySuggestions", () => {
  it("extracts only explicit, allow-listed response preferences", () => {
    const result = extractExplicitMemorySuggestions("I prefer concise responses.");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      content: "The owner prefers concise responses.",
      evidenceExcerpt: "I prefer concise responses",
      confidence: 0.9,
    });
  });

  it("supports a small set of explicit Arabic response preferences", () => {
    const result = extractExplicitMemorySuggestions("أفضل أن تكون الردود المختصرة.");
    expect(result).toHaveLength(1);
    expect(result[0].content).toContain("الردود المختصرة");
  });

  it("does not infer from general, sensitive, or unsupported statements", () => {
    expect(extractExplicitMemorySuggestions("I am Yemeni and I need help.")).toEqual([]);
    expect(extractExplicitMemorySuggestions("I prefer this medication.")).toEqual([]);
    expect(extractExplicitMemorySuggestions("Find suppliers in Riyadh.")).toEqual([]);
  });

  it("creates a stable deduplication key for repeated statements", () => {
    const first = extractExplicitMemorySuggestions("I prefer concise responses.")[0];
    const second = extractExplicitMemorySuggestions("I prefer concise responses.")[0];
    expect(first.dedupeKey).toBe(second.dedupeKey);
  });
});
