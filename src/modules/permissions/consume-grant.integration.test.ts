import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { consumePermissionGrantUse } from "./consume-grant";
import { POST as revokeGrant } from "../../app/api/v1/agents/[agentId]/grants/[grantId]/revoke/route";

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("@/lib/request-security", () => ({
  isTrustedMutationRequest: vi.fn(async () => true),
}));

const enabled = process.env.RUN_DB_INTEGRATION === "1";
const suite = enabled ? describe : describe.skip;
const suffix = randomUUID();
const userId = `grant-test-user-${suffix}`;
const agentId = `grant-test-agent-${suffix}`;
const grantId = `grant-test-grant-${suffix}`;
const revokedGrantId = `grant-test-revoked-${suffix}`;
const expiredGrantId = `grant-test-expired-${suffix}`;
const raceGrantId = `grant-test-race-${suffix}`;

suite("permission grant consumption (PostgreSQL integration)", () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: userId,
        name: "Grant Integration Test",
        email: `grant-test-${suffix}@example.invalid`,
      },
    });
    await prisma.agent.create({
      data: {
        id: agentId,
        ownerType: "USER",
        userOwnerId: userId,
        name: "Grant integration agent",
        purpose: "Integration test fixture only",
      },
    });
    await prisma.permissionGrant.createMany({
      data: [
        {
        id: grantId,
        agentId,
        purpose: "Test bounded permission consumption safely",
        actionScope: ["SEARCH_PUBLIC_WEB"],
        targetScope: ["example.invalid"],
        dataScope: ["PUBLIC_PROFILE"],
        expiresAt: new Date(Date.now() + 60_000),
        maxUses: 5,
        },
        {
          id: revokedGrantId,
          agentId,
          purpose: "Revocation integration fixture",
          actionScope: ["SEARCH_PUBLIC_WEB"],
          targetScope: ["example.invalid"],
          dataScope: ["PUBLIC_PROFILE"],
          expiresAt: new Date(Date.now() + 60_000),
          maxUses: 3,
          status: "REVOKED",
          revokedAt: new Date(),
        },
        {
          id: expiredGrantId,
          agentId,
          purpose: "Expiry integration fixture",
          actionScope: ["SEARCH_PUBLIC_WEB"],
          targetScope: ["example.invalid"],
          dataScope: ["PUBLIC_PROFILE"],
          expiresAt: new Date(Date.now() - 60_000),
          maxUses: 3,
        },
        {
          id: raceGrantId,
          agentId,
          purpose: "Concurrent consume and revoke integration fixture",
          actionScope: ["SEARCH_PUBLIC_WEB"],
          targetScope: ["example.invalid"],
          dataScope: ["PUBLIC_PROFILE"],
          expiresAt: new Date(Date.now() + 60_000),
          maxUses: 1,
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.auditEvent.deleteMany({ where: { agentId } });
    await prisma.permissionGrant.deleteMany({ where: { agentId } });
    await prisma.agent.deleteMany({ where: { id: agentId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    vi.mocked(auth.api.getSession).mockReset();
  });

  it("never consumes more than maxUses under concurrent requests", async () => {
    const attempts = await Promise.all(
      Array.from({ length: 25 }, () =>
        consumePermissionGrantUse({
          grantId,
          agentId,
          actorUserId: userId,
          action: "SEARCH_PUBLIC_WEB",
          target: "example.invalid",
          dataScope: "PUBLIC_PROFILE",
        }),
      ),
    );

    expect(attempts.filter((result) => result.status === "CONSUMED")).toHaveLength(5);
    expect(attempts.filter((result) => result.status === "EXHAUSTED")).toHaveLength(20);

    const stored = await prisma.permissionGrant.findUniqueOrThrow({
      where: { id: grantId },
      select: { uses: true },
    });
    expect(stored.uses).toBe(5);

    const auditEvents = await prisma.auditEvent.count({
      where: { agentId, action: "permission_grant.use_consumed" },
    });
    expect(auditEvents).toBe(5);
  });

  it("refuses consumption after a grant has been revoked", async () => {
    const result = await consumePermissionGrantUse({
      grantId: revokedGrantId,
      agentId,
      actorUserId: userId,
      action: "SEARCH_PUBLIC_WEB",
      target: "example.invalid",
      dataScope: "PUBLIC_PROFILE",
    });
    expect(result.status).toBe("REVOKED");
    const stored = await prisma.permissionGrant.findUniqueOrThrow({
      where: { id: revokedGrantId },
      select: { uses: true },
    });
    expect(stored.uses).toBe(0);
  });

  it("refuses consumption after grant expiry", async () => {
    const result = await consumePermissionGrantUse({
      grantId: expiredGrantId,
      agentId,
      actorUserId: userId,
      action: "SEARCH_PUBLIC_WEB",
      target: "example.invalid",
      dataScope: "PUBLIC_PROFILE",
    });
    expect(result.status).toBe("EXPIRED");
    const stored = await prisma.permissionGrant.findUniqueOrThrow({
      where: { id: expiredGrantId },
      select: { uses: true },
    });
    expect(stored.uses).toBe(0);
  });


  it("linearizes concurrent grant consumption and revocation without use after revoke", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: userId },
    } as never);

    const [revokeResponse, consumeResult] = await Promise.all([
      revokeGrant(
        new Request(`http://localhost/api/v1/agents/${agentId}/grants/${raceGrantId}/revoke`, {
          method: "POST",
          headers: { Origin: "http://localhost:3000" },
        }),
        { params: Promise.resolve({ agentId, grantId: raceGrantId }) },
      ),
      consumePermissionGrantUse({
        grantId: raceGrantId,
        agentId,
        actorUserId: userId,
        action: "SEARCH_PUBLIC_WEB",
        target: "example.invalid",
        dataScope: "PUBLIC_PROFILE",
      }),
    ]);

    expect(revokeResponse.status).toBe(200);
    expect(["CONSUMED", "REVOKED", "CONFLICT"]).toContain(consumeResult.status);

    const stored = await prisma.permissionGrant.findUniqueOrThrow({
      where: { id: raceGrantId },
      select: { status: true, uses: true },
    });
    expect(stored.status).toBe("REVOKED");
    expect(stored.uses).toBe(consumeResult.status === "CONSUMED" ? 1 : 0);

    const [revokeAudits, consumeAudits] = await Promise.all([
      prisma.auditEvent.count({
        where: { agentId, targetId: raceGrantId, action: "permission_grant.revoked" },
      }),
      prisma.auditEvent.count({
        where: { agentId, targetId: raceGrantId, action: "permission_grant.use_consumed" },
      }),
    ]);
    expect(revokeAudits).toBe(1);
    expect(consumeAudits).toBe(stored.uses);
  });

  it("does not consume a use when the requested target is outside the grant", async () => {
    const result = await consumePermissionGrantUse({
      grantId,
      agentId,
      actorUserId: userId,
      action: "SEARCH_PUBLIC_WEB",
      target: "other.example.invalid",
      dataScope: "PUBLIC_PROFILE",
    });
    expect(result.status).toBe("SCOPE_DENIED");
  });
});
