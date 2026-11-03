import { afterEach, describe, expect, it } from "vitest";
import { isTrustedMutationRequest } from "./request-security";

describe("isTrustedMutationRequest", () => {
  const original = process.env.BETTER_AUTH_URL;

  afterEach(() => {
    if (original === undefined) delete process.env.BETTER_AUTH_URL;
    else process.env.BETTER_AUTH_URL = original;
  });

  it("accepts a same-origin browser mutation", () => {
    process.env.BETTER_AUTH_URL = "https://network.example";
    const request = new Request("https://network.example/api/v1/agents", {
      method: "POST",
      headers: {
        origin: "https://network.example",
        "sec-fetch-site": "same-origin",
        "content-length": "120",
      },
    });
    expect(isTrustedMutationRequest(request)).toBe(true);
  });

  it("rejects missing and cross-origin Origin headers", () => {
    process.env.BETTER_AUTH_URL = "https://network.example";
    expect(
      isTrustedMutationRequest(new Request("https://network.example/api/v1/agents", { method: "POST" })),
    ).toBe(false);
    expect(
      isTrustedMutationRequest(
        new Request("https://network.example/api/v1/agents", {
          method: "POST",
          headers: { origin: "https://attacker.example" },
        }),
      ),
    ).toBe(false);
  });

  it("rejects cross-site fetches and oversized declared bodies", () => {
    process.env.BETTER_AUTH_URL = "https://network.example";
    const crossSite = new Request("https://network.example/api/v1/agents", {
      method: "POST",
      headers: { origin: "https://network.example", "sec-fetch-site": "cross-site" },
    });
    const oversized = new Request("https://network.example/api/v1/agents", {
      method: "POST",
      headers: { origin: "https://network.example", "content-length": "40000" },
    });
    expect(isTrustedMutationRequest(crossSite)).toBe(false);
    expect(isTrustedMutationRequest(oversized)).toBe(false);
  });
});
