import { describe, expect, it } from "vitest";
import { selectPersonalContext, type PersonalMemoryContextItem } from "./context";

const now = new Date("2026-11-04T12:00:00.000Z");
const memory = (overrides: Partial<PersonalMemoryContextItem> = {}): PersonalMemoryContextItem => ({
  id: "memory-1",
  kind: "CONFIRMED",
  content: "The owner prefers concise Arabic communication.",
  purpose: "Personalize agent responses",
  classification: "CONTEXTUAL",
  confidence: null,
  sourceType: "USER_STATEMENT",
  sourceReference: null,
  expiresAt: null,
  taskContextRunId: null,
  status: "ACTIVE",
  ...overrides,
});

describe("selectPersonalContext", () => {
  it("includes confirmed owner context and excludes private or highly sensitive data by default", () => {
    const result = selectPersonalContext([
      memory(),
      memory({ id: "private", classification: "PRIVATE" }),
      memory({ id: "sensitive", classification: "HIGHLY_SENSITIVE" }),
    ], { now });
    expect(result.map((item) => item.id)).toEqual(["memory-1"]);
  });

  it("includes inferred memory only at confidence 0.8 or higher", () => {
    const result = selectPersonalContext([
      memory({ id: "low", kind: "INFERRED", confidence: 0.79 }),
      memory({ id: "high", kind: "INFERRED", confidence: 0.8 }),
    ], { now });
    expect(result.map((item) => item.id)).toEqual(["high"]);
  });

  it("includes task context only for its exact run", () => {
    const result = selectPersonalContext([
      memory({ id: "same-run", kind: "TASK_CONTEXT", taskContextRunId: "run-1" }),
      memory({ id: "other-run", kind: "TASK_CONTEXT", taskContextRunId: "run-2" }),
    ], { now, runId: "run-1" });
    expect(result.map((item) => item.id)).toEqual(["same-run"]);
  });

  it("excludes expired and archived records", () => {
    const result = selectPersonalContext([
      memory({ id: "expired", expiresAt: new Date("2026-11-04T11:59:59.000Z") }),
      memory({ id: "archived", status: "ARCHIVED" }),
    ], { now });
    expect(result).toEqual([]);
  });

  it("limits context to at most fifty entries", () => {
    const result = selectPersonalContext(
      Array.from({ length: 60 }, (_, index) => memory({ id: String(index) })),
      { now, maxItems: 100 },
    );
    expect(result).toHaveLength(50);
  });
});
