import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  claimNextAgentRun,
  failAgentRun,
  heartbeatAgentRun,
  recoverExpiredAgentRunLeases,
} from "./worker";

const enabled = process.env.RUN_DB_INTEGRATION === "1";
const suite = enabled ? describe : describe.skip;
const suffix = randomUUID();
const ownerId = `worker-owner-${suffix}`;
const agentId = `worker-agent-${suffix}`;
const grantId = `worker-grant-${suffix}`;
const runId = `worker-run-${suffix}`;

suite("agent worker lease protocol (PostgreSQL integration)", () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: { id: ownerId, name: "Worker Owner", email: `worker-${suffix}@example.invalid` },
    });
    await prisma.agent.create({
      data: {
        id: agentId,
        ownerType: "USER",
        userOwnerId: ownerId,
        name: "Worker Test Agent",
        purpose: "Research public supplier information.",
        status: "ACTIVE",
        configurationVersion: 4,
      },
    });
    await prisma.agentCapability.create({
      data: {
        agentId,
        key: "SEARCH_PUBLIC_WEB",
        description: "Search public web sources under an owner grant.",
        languages: ["ar", "en"],
      },
    });
    await prisma.permissionGrant.create({
      data: {
        id: grantId,
        agentId,
        purpose: "Research public suppliers for the owner.",
        actionScope: ["SEARCH_PUBLIC_WEB"],
        targetScope: ["PUBLIC_WEB"],
        dataScope: ["PUBLIC_PROFILE"],
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        maxUses: 3,
        reservedUses: 1,
      },
    });
    await prisma.agentRun.create({
      data: {
        id: runId,
        agentId,
        requesterUserId: ownerId,
        ownerType: "USER",
        ownerId,
        task: "Research public supplier information.",
        purpose: "Research public suppliers for the owner.",
        target: "PUBLIC_WEB",
        authorizedActions: ["SEARCH_PUBLIC_WEB"],
        grantIds: [grantId],
        requestDigest: "a".repeat(64),
        idempotencyKey: `worker-run-key-${suffix}`,
        status: "QUEUED",
        maxAttempts: 3,
        agentConfigurationVersion: 1,
      },
    });
  });

  afterAll(async () => {
    await prisma.auditEvent.deleteMany({ where: { agentId } });
    await prisma.agentRun.deleteMany({ where: { agentId } });
    await prisma.permissionGrant.deleteMany({ where: { id: grantId } });
    await prisma.agentCapability.deleteMany({ where: { agentId } });
    await prisma.agent.deleteMany({ where: { id: agentId } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
  });

  it("leases once, rejects another worker, renews leases, retries and dead-letters at the ceiling", async () => {
    const first = await claimNextAgentRun("worker-one");
    expect(first).toMatchObject({
      id: runId,
      status: "CLAIMED",
      attemptCount: 1,
      workerId: "worker-one",
      agentConfigurationVersion: 4,
    });

    const duplicate = await claimNextAgentRun("worker-two");
    expect(duplicate).toBeNull();
    expect(await heartbeatAgentRun(runId, "worker-two")).toBe(false);
    expect(await heartbeatAgentRun(runId, "worker-one")).toBe(true);

    await prisma.agentRun.update({
      where: { id: runId },
      data: { leaseExpiresAt: new Date(Date.now() - 1000) },
    });
    await expect(recoverExpiredAgentRunLeases()).resolves.toMatchObject({ requeued: 1, deadLettered: 0 });
    let saved = await prisma.agentRun.findUniqueOrThrow({ where: { id: runId } });
    expect(saved).toMatchObject({ status: "QUEUED", attemptCount: 1, workerId: null });

    await prisma.agentRun.update({ where: { id: runId }, data: { availableAt: new Date(Date.now() - 1000) } });
    const second = await claimNextAgentRun("worker-two");
    expect(second).toMatchObject({ id: runId, status: "CLAIMED", attemptCount: 2 });
    await expect(failAgentRun(runId, "worker-two", "PROVIDER_UNAVAILABLE", true)).resolves.toBe("QUEUED");

    await prisma.agentRun.update({ where: { id: runId }, data: { availableAt: new Date(Date.now() - 1000) } });
    const third = await claimNextAgentRun("worker-three");
    expect(third).toMatchObject({ id: runId, status: "CLAIMED", attemptCount: 3 });

    await prisma.agentRun.update({
      where: { id: runId },
      data: { leaseExpiresAt: new Date(Date.now() - 1000) },
    });
    await expect(recoverExpiredAgentRunLeases()).resolves.toMatchObject({ requeued: 0, deadLettered: 1 });
    saved = await prisma.agentRun.findUniqueOrThrow({ where: { id: runId } });
    expect(saved).toMatchObject({ status: "DEAD_LETTER", attemptCount: 3, errorCode: "WORKER_LEASE_EXPIRED" });
    const grant = await prisma.permissionGrant.findUniqueOrThrow({ where: { id: grantId } });
    expect(grant.reservedUses).toBe(0);
    await expect(
      prisma.auditEvent.count({ where: { agentId, action: "agent.run.dead_lettered" } }),
    ).resolves.toBe(1);
  });

  it("fails a run closed when the agent is paused before claim", async () => {
    const pausedAgentId = `worker-paused-agent-${suffix}`;
    const pausedGrantId = `worker-paused-grant-${suffix}`;
    const pausedRunId = `worker-paused-run-${suffix}`;
    try {
      await prisma.agent.create({
        data: {
          id: pausedAgentId,
          ownerType: "USER",
          userOwnerId: ownerId,
          name: "Paused Agent",
          purpose: "Research public supplier information.",
          status: "PAUSED",
        },
      });
      await prisma.agentCapability.create({
        data: { agentId: pausedAgentId, key: "SEARCH_PUBLIC_WEB", description: "Search.", languages: ["en"] },
      });
      await prisma.permissionGrant.create({
        data: {
          id: pausedGrantId,
          agentId: pausedAgentId,
          purpose: "Research public suppliers for the owner.",
          actionScope: ["SEARCH_PUBLIC_WEB"],
          targetScope: ["PUBLIC_WEB"],
          dataScope: ["PUBLIC_PROFILE"],
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          maxUses: 1,
          reservedUses: 1,
        },
      });
      await prisma.agentRun.create({
        data: {
          id: pausedRunId,
          agentId: pausedAgentId,
          requesterUserId: ownerId,
          ownerType: "USER",
          ownerId,
          task: "Research public supplier information.",
          purpose: "Research public suppliers for the owner.",
          target: "PUBLIC_WEB",
          authorizedActions: ["SEARCH_PUBLIC_WEB"],
          grantIds: [pausedGrantId],
          requestDigest: "b".repeat(64),
          idempotencyKey: `worker-paused-key-${suffix}`,
          status: "QUEUED",
        },
      });
      const claimed = await claimNextAgentRun("worker-four");
      expect(claimed?.id).not.toBe(pausedRunId);
      const saved = await prisma.agentRun.findUniqueOrThrow({ where: { id: pausedRunId } });
      expect(saved).toMatchObject({ status: "CANCELLED", errorCode: "AGENT_NOT_ACTIVE" });
      const grant = await prisma.permissionGrant.findUniqueOrThrow({ where: { id: pausedGrantId } });
      expect(grant.reservedUses).toBe(0);
    } finally {
      await prisma.auditEvent.deleteMany({ where: { agentId: pausedAgentId } });
      await prisma.agentRun.deleteMany({ where: { id: pausedRunId } });
      await prisma.permissionGrant.deleteMany({ where: { id: pausedGrantId } });
      await prisma.agentCapability.deleteMany({ where: { agentId: pausedAgentId } });
      await prisma.agent.deleteMany({ where: { id: pausedAgentId } });
    }
  });
  it("cancels a queued organization run when its requester loses membership", async () => {
    const organizationId = `worker-org-${suffix}`;
    const organizationAgentId = `worker-org-agent-${suffix}`;
    const organizationGrantId = `worker-org-grant-${suffix}`;
    const organizationRunId = `worker-org-run-${suffix}`;
    try {
      await prisma.organization.create({
        data: { id: organizationId, name: "Worker Test Organization", slug: `worker-org-${suffix}` },
      });
      await prisma.membership.create({
        data: { organizationId, userId: ownerId, role: "VIEWER" },
      });
      await prisma.agent.create({
        data: {
          id: organizationAgentId,
          ownerType: "ORGANIZATION",
          organizationOwnerId: organizationId,
          name: "Organization Agent",
          purpose: "Research public supplier information.",
          status: "ACTIVE",
        },
      });
      await prisma.agentCapability.create({
        data: { agentId: organizationAgentId, key: "SEARCH_PUBLIC_WEB", description: "Search.", languages: ["en"] },
      });
      await prisma.permissionGrant.create({
        data: {
          id: organizationGrantId,
          agentId: organizationAgentId,
          purpose: "Research public suppliers for the owner.",
          actionScope: ["SEARCH_PUBLIC_WEB"],
          targetScope: ["PUBLIC_WEB"],
          dataScope: ["PUBLIC_PROFILE"],
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          maxUses: 1,
          reservedUses: 1,
        },
      });
      await prisma.agentRun.create({
        data: {
          id: organizationRunId,
          agentId: organizationAgentId,
          requesterUserId: ownerId,
          ownerType: "ORGANIZATION",
          ownerId: organizationId,
          task: "Research public supplier information.",
          purpose: "Research public suppliers for the owner.",
          target: "PUBLIC_WEB",
          authorizedActions: ["SEARCH_PUBLIC_WEB"],
          grantIds: [organizationGrantId],
          requestDigest: "c".repeat(64),
          idempotencyKey: `worker-org-key-${suffix}`,
          status: "QUEUED",
        },
      });
      await prisma.membership.delete({
        where: { organizationId_userId: { organizationId, userId: ownerId } },
      });
      expect(await claimNextAgentRun("worker-org-worker")).toBeNull();
      const saved = await prisma.agentRun.findUniqueOrThrow({ where: { id: organizationRunId } });
      expect(saved).toMatchObject({ status: "CANCELLED", errorCode: "REQUESTER_ACCESS_REVOKED" });
      const grant = await prisma.permissionGrant.findUniqueOrThrow({ where: { id: organizationGrantId } });
      expect(grant.reservedUses).toBe(0);
    } finally {
      await prisma.auditEvent.deleteMany({ where: { agentId: organizationAgentId } });
      await prisma.agentRun.deleteMany({ where: { id: organizationRunId } });
      await prisma.permissionGrant.deleteMany({ where: { id: organizationGrantId } });
      await prisma.agentCapability.deleteMany({ where: { agentId: organizationAgentId } });
      await prisma.agent.deleteMany({ where: { id: organizationAgentId } });
      await prisma.membership.deleteMany({ where: { organizationId, userId: ownerId } });
      await prisma.organization.deleteMany({ where: { id: organizationId } });
    }
  });

});
