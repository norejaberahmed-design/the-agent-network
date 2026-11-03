import { describe, expect, it } from "vitest";
import { apiError } from "./api-response";

describe("apiError", () => {
  it("returns a stable non-cacheable error envelope", async () => {
    const response = apiError("UNAUTHENTICATED", 401);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.error.code).toBe("UNAUTHENTICATED");
    expect(body.error.message).toBeTruthy();
    expect(body.error.correlationId).toBeTruthy();
  });

  it("includes validation details without changing the error shape", async () => {
    const response = apiError("VALIDATION_FAILED", 422, { fieldErrors: { name: ["Required"] } });
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error.details.fieldErrors.name).toEqual(["Required"]);
  });
});
