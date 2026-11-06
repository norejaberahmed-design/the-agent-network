import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { digestApprovalPayload } from "./digest";

const KEY_ENV = "APPROVAL_PAYLOAD_ENCRYPTION_KEY";
const KEY_VERSION = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export type ApprovalPayloadVaultRecord = {
  encryptedPayload: string;
  payloadNonce: string;
  payloadAuthTag: string;
  payloadKeyVersion: number;
};

export type ApprovalPayloadBinding = {
  approvalId: string;
  agentId: string;
  grantId: string;
  payloadDigest: string;
};

function getEncryptionKey(): Buffer {
  const encoded = process.env[KEY_ENV];
  if (!encoded) throw new Error("APPROVAL_PAYLOAD_ENCRYPTION_KEY_MISSING");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) {
    throw new Error("APPROVAL_PAYLOAD_ENCRYPTION_KEY_INVALID");
  }
  return key;
}

function createAad(binding: ApprovalPayloadBinding): Buffer {
  return Buffer.from([
    "the-agent-network",
    "approval-payload",
    "v1",
    binding.approvalId,
    binding.agentId,
    binding.grantId,
    binding.payloadDigest,
  ].join(":"), "utf8");
}

export function encryptApprovalPayload(
  payload: Record<string, unknown>,
  binding: ApprovalPayloadBinding,
): ApprovalPayloadVaultRecord {
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), nonce, {
    authTagLength: TAG_BYTES,
  });
  cipher.setAAD(createAad(binding));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    encryptedPayload: ciphertext.toString("base64"),
    payloadNonce: nonce.toString("base64"),
    payloadAuthTag: cipher.getAuthTag().toString("base64"),
    payloadKeyVersion: KEY_VERSION,
  };
}

export function decryptApprovalPayload(
  record: ApprovalPayloadVaultRecord,
  binding: ApprovalPayloadBinding,
): Record<string, unknown> {
  if (record.payloadKeyVersion !== KEY_VERSION) {
    throw new Error("APPROVAL_PAYLOAD_KEY_VERSION_UNSUPPORTED");
  }
  const nonce = Buffer.from(record.payloadNonce, "base64");
  const tag = Buffer.from(record.payloadAuthTag, "base64");
  const ciphertext = Buffer.from(record.encryptedPayload, "base64");
  if (nonce.length !== NONCE_BYTES || tag.length !== TAG_BYTES || ciphertext.length === 0) {
    throw new Error("APPROVAL_PAYLOAD_CIPHERTEXT_INVALID");
  }
  const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), nonce, {
    authTagLength: TAG_BYTES,
  });
  decipher.setAAD(createAad(binding));
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const parsed: unknown = JSON.parse(plaintext.toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("APPROVAL_PAYLOAD_SHAPE_INVALID");
  }
  const payload = parsed as Record<string, unknown>;
  if (digestApprovalPayload(payload) !== binding.payloadDigest) {
    throw new Error("APPROVAL_PAYLOAD_DIGEST_MISMATCH");
  }
  return payload;
}
