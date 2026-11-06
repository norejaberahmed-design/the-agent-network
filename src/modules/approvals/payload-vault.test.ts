import { afterEach, describe, expect, it } from "vitest";
import { digestApprovalPayload } from "./digest";
import { decryptApprovalPayload, encryptApprovalPayload } from "./payload-vault";

const originalKey = process.env.APPROVAL_PAYLOAD_ENCRYPTION_KEY;
const testKey = Buffer.alloc(32, 7).toString("base64");
const binding = {
  approvalId: "approval-1",
  agentId: "agent-1",
  grantId: "grant-1",
  payloadDigest: "",
};

afterEach(() => {
  if (originalKey === undefined) delete process.env.APPROVAL_PAYLOAD_ENCRYPTION_KEY;
  else process.env.APPROVAL_PAYLOAD_ENCRYPTION_KEY = originalKey;
});

describe("approval payload vault", () => {
  it("round-trips the exact payload and verifies its digest", () => {
    process.env.APPROVAL_PAYLOAD_ENCRYPTION_KEY = testKey;
    const payload = { message: "Review this exact text", nested: { amount: 125, tags: ["a", "b"] } };
    const context = { ...binding, payloadDigest: digestApprovalPayload(payload) };
    const encrypted = encryptApprovalPayload(payload, context);

    expect(encrypted.encryptedPayload).not.toContain("Review this exact text");
    expect(decryptApprovalPayload(encrypted, context)).toEqual(payload);
  });

  it("rejects ciphertext replayed against another approval binding", () => {
    process.env.APPROVAL_PAYLOAD_ENCRYPTION_KEY = testKey;
    const payload = { message: "Bound to one approval" };
    const context = { ...binding, payloadDigest: digestApprovalPayload(payload) };
    const encrypted = encryptApprovalPayload(payload, context);

    expect(() => decryptApprovalPayload(encrypted, { ...context, approvalId: "approval-2" }))
      .toThrow();
  });

  it("fails closed when the encryption key is missing or malformed", () => {
    const payload = { message: "Never store plaintext" };
    const context = { ...binding, payloadDigest: digestApprovalPayload(payload) };
    delete process.env.APPROVAL_PAYLOAD_ENCRYPTION_KEY;
    expect(() => encryptApprovalPayload(payload, context))
      .toThrow("APPROVAL_PAYLOAD_ENCRYPTION_KEY_MISSING");

    process.env.APPROVAL_PAYLOAD_ENCRYPTION_KEY = "short";
    expect(() => encryptApprovalPayload(payload, context))
      .toThrow("APPROVAL_PAYLOAD_ENCRYPTION_KEY_INVALID");
  });

  it("rejects modified ciphertext or authentication metadata", () => {
    process.env.APPROVAL_PAYLOAD_ENCRYPTION_KEY = testKey;
    const payload = { message: "Integrity protected" };
    const context = { ...binding, payloadDigest: digestApprovalPayload(payload) };
    const encrypted = encryptApprovalPayload(payload, context);

    expect(() => decryptApprovalPayload(
      { ...encrypted, encryptedPayload: Buffer.from("tampered").toString("base64") },
      context,
    )).toThrow();
  });
});
