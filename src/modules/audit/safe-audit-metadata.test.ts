import { describe, expect, it } from "vitest";
import { projectSafeAuditMetadata } from "./safe-audit-metadata";

describe("safe audit metadata projection", () => {
  it("keeps only allowlisted lifecycle fields", () => {
    expect(
      projectSafeAuditMetadata("agent.lifecycle.updated", {
        previousStatus: "DRAFT",
        newStatus: "ACTIVE",
        previousDiscoverable: false,
        newDiscoverable: true,
        privatePurpose: "secret strategy",
        token: "one-time-secret",
      }),
    ).toEqual({
      previousStatus: "DRAFT",
      newStatus: "ACTIVE",
      previousDiscoverable: false,
      newDiscoverable: true,
    });
  });

  it("never exposes invitation emails or token material", () => {
    expect(
      projectSafeAuditMetadata("invitation.created", {
        intendedEmail: "private@example.invalid",
        role: "VIEWER",
        expiresAt: "2030-01-01T00:00:00.000Z",
        token: "secret",
        tokenHash: "secret-hash",
      }),
    ).toEqual({
      role: "VIEWER",
      expiresAt: "2030-01-01T00:00:00.000Z",
    });
  });

  it("filters grant scopes to string arrays and omits purpose", () => {
    expect(
      projectSafeAuditMetadata("permission_grant.created", {
        actionScope: ["SEARCH_PUBLIC_WEB"],
        targetScope: ["example.invalid"],
        dataScope: ["PUBLIC_PROFILE"],
        purpose: "sensitive deal strategy",
        maxUses: 3,
        nested: { secret: true },
      }),
    ).toEqual({
      actionScope: ["SEARCH_PUBLIC_WEB"],
      targetScope: ["example.invalid"],
      dataScope: ["PUBLIC_PROFILE"],
      maxUses: 3,
    });
  });

  it("returns no metadata for unknown actions or malformed values", () => {
    expect(
      projectSafeAuditMetadata("unknown.action", { secret: "value" }),
    ).toEqual({});
    expect(projectSafeAuditMetadata("agent.created", null)).toEqual({});
    expect(
      projectSafeAuditMetadata("permission_grant.created", {
        actionScope: ["ok", 3],
      }),
    ).toEqual({});
  });
  it("shows safe approval metadata without exposing preview payloads", () => {
    expect(
      projectSafeAuditMetadata("action_approval.approved", {
        actionType: "SEND_MESSAGE",
        recipient: "agent://target-1",
        payloadDigest: "a".repeat(64),
        requestedDataScope: ["PUBLIC_PROFILE"],
        decision: "APPROVE",
        payloadPreview: { apiKey: "secret" },
        rawPayload: { message: "private" },
      }),
    ).toEqual({
      actionType: "SEND_MESSAGE",
      recipient: "agent://target-1",
      payloadDigest: "a".repeat(64),
      requestedDataScope: ["PUBLIC_PROFILE"],
      decision: "APPROVE",
    });
  });

});
