import { createHash } from "node:crypto";

export type SafeApprovalJson =
  | string
  | number
  | boolean
  | null
  | SafeApprovalJson[]
  | { [key: string]: SafeApprovalJson };

const sensitiveKeyPattern =
  /(password|token|secret|api.?key|authorization|credential|private.?key|client.?secret)/i;

function canonicalize(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new TypeError("Invalid JSON value.");
    return encoded;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Non-finite numbers are not valid approval payload values.");
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new TypeError("Invalid JSON number.");
    return encoded;
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Approval payloads must contain plain JSON objects only.");
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => {
      if (record[key] === undefined) {
        throw new TypeError("Undefined values are not valid approval payload values.");
      }
      return `${JSON.stringify(key)}:${canonicalize(record[key])}`;
    }).join(",")}}`;
  }
  throw new TypeError("Approval payload contains a non-JSON value.");
}

export function digestApprovalPayload(payload: unknown): string {
  return createHash("sha256").update(canonicalize(payload)).digest("hex");
}

export function digestApprovalEnvelope(input: {
  approvalId: string;
  agentId: string;
  grantId: string;
  grantVersion: number;
  requesterUserId: string;
  actionType: string;
  recipient: string;
  requestedDataScope: string[];
  payloadDigest: string;
  expiresAt: Date;
  idempotencyKey: string;
}): string {
  const envelope = {
    approvalId: input.approvalId,
    agentId: input.agentId,
    grantId: input.grantId,
    grantVersion: input.grantVersion,
    requesterUserId: input.requesterUserId,
    actionType: input.actionType,
    recipient: input.recipient,
    requestedDataScope: [...input.requestedDataScope].sort(),
    payloadDigest: input.payloadDigest,
    expiresAt: input.expiresAt.toISOString(),
    idempotencyKey: input.idempotencyKey,
  };
  return createHash("sha256").update(canonicalize(envelope)).digest("hex");
}

function sanitizePreview(
  value: unknown,
  depth: number,
  key?: string,
): SafeApprovalJson {
  if (key && sensitiveKeyPattern.test(key)) return "[REDACTED]";
  if (depth > 4) return "[TRUNCATED]";
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : "[INVALID_NUMBER]";
  if (typeof value === "string") {
    return value.length > 500 ? `${value.slice(0, 497)}...` : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizePreview(item, depth + 1));
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return "[UNSUPPORTED_VALUE]";
    const record = value as Record<string, unknown>;
    const output: Record<string, SafeApprovalJson> = {};
    for (const entryKey of Object.keys(record).sort().slice(0, 40)) {
      const entryValue = record[entryKey];
      if (entryValue === undefined) continue;
      output[entryKey] = sanitizePreview(entryValue, depth + 1, entryKey);
    }
    return output;
  }
  return "[UNSUPPORTED_VALUE]";
}

export function createSafeApprovalPreview(payload: Record<string, unknown>): SafeApprovalJson {
  return sanitizePreview(payload, 0);
}
