import { describe, expect, it } from "vitest";
import { createPersonalMemorySchema, updatePersonalMemorySchema } from "./contract";

describe("personal memory contracts", () => {
  it("accepts an owner-confirmed fact with provenance purpose", () => {
    expect(createPersonalMemorySchema.safeParse({
      kind: "CONFIRMED",
      content: "I prefer direct, concise communication.",
      sourceReference: "owner-chat-2026-11-04",
      purpose: "Personalize responses",
      classification: "CONTEXTUAL",
    }).success).toBe(true);
  });

  it("accepts task context only with a run scope and expiry", () => {
    expect(createPersonalMemorySchema.safeParse({
      kind: "TASK_CONTEXT",
      content: "The current task concerns a supplier shortlist.",
      purpose: "Current task only",
      taskContextRunId: "run-123",
      expiresAt: "2026-11-05T12:00:00.000Z",
    }).success).toBe(true);
  });

  it("does not let clients create inferred memories directly", () => {
    expect(createPersonalMemorySchema.safeParse({
      kind: "INFERRED",
      content: "The owner probably likes sales.",
      purpose: "Personalize",
      confidence: 0.9,
    }).success).toBe(false);
  });

  it("rejects highly sensitive memory storage through the owner API", () => {
    expect(createPersonalMemorySchema.safeParse({
      kind: "CONFIRMED",
      content: "Sensitive value",
      purpose: "Personalize",
      classification: "HIGHLY_SENSITIVE",
    }).success).toBe(false);
  });

  it("requires at least one valid correction or review action", () => {
    expect(updatePersonalMemorySchema.safeParse({}).success).toBe(false);
    expect(updatePersonalMemorySchema.safeParse({ confirm: true }).success).toBe(true);
    expect(updatePersonalMemorySchema.safeParse({ status: "DELETED" }).success).toBe(false);
  });
});
