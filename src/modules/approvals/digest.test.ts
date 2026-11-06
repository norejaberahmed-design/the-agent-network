import { describe, expect, it } from "vitest";
import {
  createSafeApprovalPreview,
  digestApprovalEnvelope,
  digestApprovalPayload,
  isApprovalPayloadReviewable,
} from "./digest";

describe("exact-payload approval digests", () => {
  it("canonicalizes object key order without changing the digest", () => {
    expect(digestApprovalPayload({ b: 2, a: 1 })).toBe(
      digestApprovalPayload({ a: 1, b: 2 }),
    );
  });

  it("changes the payload digest when any action value changes", () => {
    expect(digestApprovalPayload({ amount: 10 })).not.toBe(
      digestApprovalPayload({ amount: 11 }),
    );
  });

  it("binds the approval digest to the recipient, action, grant, and expiry", () => {
    const base = {
      approvalId: "approval-1",
      agentId: "agent-1",
      grantId: "grant-1",
      grantVersion: 3,
      requesterUserId: "user-1",
      actionType: "SEND_MESSAGE",
      recipient: "agent://recipient-1",
      requestedDataScope: ["PUBLIC_PROFILE", "CONTACT"],
      payloadDigest: digestApprovalPayload({ message: "hello" }),
      expiresAt: new Date("2026-11-03T12:00:00.000Z"),
      idempotencyKey: "request-key-1",
    };
    const digest = digestApprovalEnvelope(base);
    expect(digestApprovalEnvelope({
      ...base,
      requestedDataScope: ["CONTACT", "PUBLIC_PROFILE"],
    })).toBe(digest);
    expect(digestApprovalEnvelope({
      ...base,
      recipient: "agent://recipient-2",
    })).not.toBe(digest);
    expect(digestApprovalEnvelope({
      ...base,
      actionType: "DELETE_RESOURCE",
    })).not.toBe(digest);
    expect(digestApprovalEnvelope({
      ...base,
      grantVersion: 4,
    })).not.toBe(digest);
  });

  it("redacts credential-like fields from the human-readable preview", () => {
    expect(createSafeApprovalPreview({
      action: "send",
      apiKey: "top-secret",
      nested: {
        accessToken: "private-token",
        note: "approved",
      },
    })).toEqual({
      action: "send",
      apiKey: "[REDACTED]",
      nested: {
        accessToken: "[REDACTED]",
        note: "approved",
      },
    });
  });

  it("bounds preview depth, arrays, and string lengths", () => {
    const longText = "x".repeat(600);
    const preview = createSafeApprovalPreview({
      longText,
      values: Array.from({ length: 25 }, (_, index) => index),
      nested: { a: { b: { c: { d: { e: "deep" } } } } },
    }) as Record<string, unknown>;
    expect((preview.longText as string).length).toBe(500);
    expect((preview.values as unknown[])).toHaveLength(20);
    expect(JSON.stringify(preview)).toContain("[TRUNCATED]");
  });

  it("allows only complete owner-visible approval payload previews", () => {
    expect(isApprovalPayloadReviewable({
      message: "A complete message",
      details: { quantity: 3, labels: ["one", "two"] },
    })).toBe(true);
    expect(isApprovalPayloadReviewable({ message: "hello", apiKey: "secret" })).toBe(false);
    expect(isApprovalPayloadReviewable({ nested: { refreshToken: "secret" } })).toBe(false);
    expect(isApprovalPayloadReviewable({ message: "x".repeat(501) })).toBe(false);
    expect(isApprovalPayloadReviewable({ items: Array.from({ length: 21 }, (_, i) => i) })).toBe(false);
    expect(isApprovalPayloadReviewable(Object.fromEntries(
      Array.from({ length: 41 }, (_, i) => [`field${i}`, i]),
    ))).toBe(false);
  });

  it("rejects non-JSON values and non-finite numbers", () => {
    expect(() => digestApprovalPayload({ amount: Number.NaN })).toThrow();
    expect(() => digestApprovalPayload({ value: undefined })).toThrow();
    expect(() => digestApprovalPayload({ value: () => "no" })).toThrow();
  });
});
