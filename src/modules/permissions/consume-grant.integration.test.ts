import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { consumePermissionGrantUse } from "./consume-grant";

const enabled = process.env.RUN_DB_INTEGRATION === "1";
const suite = enabled ? describe : describe.skip;
const suffix = randomUUID();
const userId = `grant-test-user-${suffix}`;
const agentId = `grant-test-agent-${suffix}`;
const grantId = `grant-test-grant-${suffix}`;

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
    await prisma.permissionGrant.create({
      data: {
        id: grantId,
        agentId,
        purpose: "Test bounded permission consumption safely",
        actionScope: ["SEARCH_PUBLIC_WEB"],
        targetScope: ["example.invalid"],
        dataScope: ["PUBLIC_PROFILE"],
        expiresAt: new Date(Date.now() + 60_000),
        maxUses: 5,
      },
    });
  });

  afterAll(async () => {
    await prisma.auditEvent.deleteMany({ where: { agentId } });
    await prisma.agent.deleteMany({ where: { id: agentId } });
    await prisma.user.deleteMany({ where: { id: userId } });
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
