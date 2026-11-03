import { describe, expect, it } from "vitest";
import { createPermissionGrantSchema, isSafePublicDisclosure } from "./contract";

describe("permission grant contract", () => {
  it("accepts a bounded internal discovery grant", () => {
    const parsed = createPermissionGrantSchema.safeParse({
      purpose: "Find relevant public agent profiles for my stated need.",
      actionScope: ["DISCOVER_INTERNAL"],
      targetScope: ["INTERNAL_REGISTRY"],
      dataScope: ["PUBLIC_PROFILE"],
      expiresAt: "2027-01-01T00:00:00.000Z",
      maxUses: 20,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an empty scope or an unrecognized action", () => {
    expect(createPermissionGrantSchema.safeParse({
      purpose: "Search for public profiles matching a request.",
      actionScope: [],
      targetScope: ["INTERNAL_REGISTRY"],
      dataScope: ["PUBLIC_PROFILE"],
      expiresAt: "2027-01-01T00:00:00.000Z",
    }).success).toBe(false);
    expect(createPermissionGrantSchema.safeParse({
      purpose: "Search for public profiles matching a request.",
      actionScope: ["EXECUTE_PAYMENT"],
      targetScope: ["INTERNAL_REGISTRY"],
      dataScope: ["PUBLIC_PROFILE"],
      expiresAt: "2027-01-01T00:00:00.000Z",
    }).success).toBe(false);
  });

  it("never permits private or sensitive fields to be public", () => {
    expect(isSafePublicDisclosure("PUBLIC", true)).toBe(true);
    expect(isSafePublicDisclosure("CONTEXTUAL", true)).toBe(false);
    expect(isSafePublicDisclosure("PRIVATE", true)).toBe(false);
    expect(isSafePublicDisclosure("HIGHLY_SENSITIVE", true)).toBe(false);
    expect(isSafePublicDisclosure("PRIVATE", false)).toBe(true);
  });
});
