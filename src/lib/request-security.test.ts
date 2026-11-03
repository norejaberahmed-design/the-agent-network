import { afterEach, describe, expect, it } from "vitest";
import { isTrustedMutationRequest } from "./request-security";

describe("isTrustedMutationRequest", () => {
  const original = process.env.BETTER_AUTH_URL;

  afterEach(() => {
    if (original === undefined) delete process.env.BETTER_AUTH_URL;
    else process.env.BETTER_AUTH_URL = original;
  });

  it("accepts a same-origin browser mutation within the declared size limit", async () => {
    process.env.BETTER_AUTH_URL = "https://network.example";
    const request = new Request("https://network.example/api/v1/agents", {
      method: "POST",
      headers: {
        origin: "https://network.example",
        "sec-fetch-site": "same-origin",
        "content-length": "120",
      },
      body: "x".repeat(120),
    });
    expect(await isTrustedMutationRequest(request)).toBe(true);
  });

  it("rejects missing and cross-origin Origin headers", async () => {
    process.env.BETTER_AUTH_URL = "https://network.example";
    expect(
      await isTrustedMutationRequest(new Request("https://network.example/api/v1/agents", { method: "POST" })),
    ).toBe(false);
    expect(
      await isTrustedMutationRequest(
        new Request("https://network.example/api/v1/agents", {
          method: "POST",
          headers: { origin: "https://attacker.example" },
          body: "{}",
        }),
      ),
    ).toBe(false);
  });

  it("rejects cross-site fetches and oversized or malformed declared lengths", async () => {
    process.env.BETTER_AUTH_URL = "https://network.example";
    const crossSite = new Request("https://network.example/api/v1/agents", {
      method: "POST",
      headers: { origin: "https://network.example", "sec-fetch-site": "cross-site" },
    });
    const oversized = new Request("https://network.example/api/v1/agents", {
      method: "POST",
      headers: { origin: "https://network.example", "content-length": "40000" },
      body: "x",
    });
    const malformed = new Request("https://network.example/api/v1/agents", {
      method: "POST",
      headers: { origin: "https://network.example", "content-length": "unknown" },
      body: "{}",
    });
    expect(await isTrustedMutationRequest(crossSite)).toBe(false);
    expect(await isTrustedMutationRequest(oversized)).toBe(false);
    expect(await isTrustedMutationRequest(malformed)).toBe(false);
  });

  it("enforces the byte limit when Content-Length is absent", async () => {
    process.env.BETTER_AUTH_URL = "https://network.example";
    const oversized = new Request("https://network.example/api/v1/agents", {
      method: "POST",
      headers: { origin: "https://network.example" },
      body: "x".repeat(32_769),
    });
    expect(oversized.headers.has("content-length")).toBe(false);
    expect(await isTrustedMutationRequest(oversized)).toBe(false);
  });

  it("accepts streamed bodies without Content-Length when within the byte limit", async () => {
    process.env.BETTER_AUTH_URL = "https://network.example";
    const request = new Request("https://network.example/api/v1/agents", {
      method: "POST",
      headers: { origin: "https://network.example" },
      body: "x".repeat(32_768),
    });
    expect(request.headers.has("content-length")).toBe(false);
    expect(await isTrustedMutationRequest(request)).toBe(true);
  });
});
