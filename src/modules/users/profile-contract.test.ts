import { describe, expect, it } from "vitest";
import { updateProfileSchema } from "./profile-contract";

describe("updateProfileSchema", () => {
  it("trims and accepts a valid display name", () => {
    expect(updateProfileSchema.parse({ name: "  Amina Saleh  " })).toEqual({
      name: "Amina Saleh",
    });
  });

  it("rejects names outside the supported length", () => {
    expect(updateProfileSchema.safeParse({ name: "A" }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ name: "x".repeat(81) }).success).toBe(false);
  });

  it("rejects unexpected fields so identity attributes cannot be mass-assigned", () => {
    expect(updateProfileSchema.safeParse({
      name: "Amina Saleh",
      platformRole: "ADMIN",
      email: "attacker@example.com",
    }).success).toBe(false);
  });
});
