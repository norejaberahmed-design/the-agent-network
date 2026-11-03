import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";

export type PermissionGrantUseInput = {
  grantId: string;
  agentId: string;
  actorUserId: string;
  action: "DISCOVER_INTERNAL" | "SEARCH_PUBLIC_WEB";
  target: string;
  dataScope: "PUBLIC_PROFILE" | "OWNER_APPROVED_CONTEXTUAL";
  now?: Date;
};

export type PermissionGrantUseResult =
  | { status: "CONSUMED"; uses: number; correlationId: string }
  | { status: "NOT_FOUND" | "REVOKED" | "EXPIRED" | "EXHAUSTED" | "SCOPE_DENIED" | "CONFLICT" };

function hasExactScope(values: string[], requested: string) {
  return values.includes(requested);
}

/**
 * Atomically consumes one use of a grant after checking its declared scopes.
 *
 * This is a low-level authorization primitive, not an execution endpoint.
 * Callers must authenticate the actor, authorize access to the agent, obtain
 * any required human approval, and enforce field-disclosure policies before
 * performing an external action. This function never performs that action.
 */
export async function consumePermissionGrantUse(
  input: PermissionGrantUseInput,
): Promise<PermissionGrantUseResult> {
  const now = input.now ?? new Date();
  const correlationId = randomUUID();

  return prisma.$transaction(async (tx) => {
    const grant = await tx.permissionGrant.findFirst({
      where: { id: input.grantId, agentId: input.agentId },
      select: {
        id: true,
        purpose: true,
        actionScope: true,
        targetScope: true,
        dataScope: true,
        expiresAt: true,
        maxUses: true,
        uses: true,
        version: true,
        status: true,
        agent: {
          select: {
            ownerType: true,
            userOwnerId: true,
            organizationOwnerId: true,
          },
        },
      },
    });

    if (!grant) return { status: "NOT_FOUND" };
    if (grant.status === "REVOKED") return { status: "REVOKED" };
    if (grant.status === "EXPIRED") return { status: "EXPIRED" };
    if (grant.status !== "ACTIVE") return { status: "REVOKED" };
    if (grant.expiresAt <= now) return { status: "EXPIRED" };

    if (
      !hasExactScope(grant.actionScope, input.action) ||
      !hasExactScope(grant.targetScope, input.target) ||
      !hasExactScope(grant.dataScope, input.dataScope)
    ) {
      return { status: "SCOPE_DENIED" };
    }

    if (grant.maxUses !== null && grant.uses >= grant.maxUses) {
      return { status: "EXHAUSTED" };
    }

    // The uses < maxUses predicate is evaluated by PostgreSQL in the UPDATE,
    // so concurrent callers cannot all consume the final available use.
    const changed = await tx.permissionGrant.updateMany({
      where: {
        id: input.grantId,
        agentId: input.agentId,
        status: "ACTIVE",
        expiresAt: { gt: now },
        ...(grant.maxUses === null
          ? { maxUses: null }
          : { maxUses: grant.maxUses, uses: { lt: grant.maxUses } }),
      },
      data: { uses: { increment: 1 } },
    });

    if (changed.count !== 1) {
      const current = await tx.permissionGrant.findFirst({
        where: { id: input.grantId, agentId: input.agentId },
        select: { status: true, expiresAt: true, maxUses: true, uses: true },
      });
      if (!current) return { status: "NOT_FOUND" };
      if (current.status === "REVOKED") return { status: "REVOKED" };
      if (current.status === "EXPIRED") return { status: "EXPIRED" };
      if (current.status !== "ACTIVE") return { status: "REVOKED" };
      if (current.expiresAt <= now) return { status: "EXPIRED" };
      if (current.maxUses !== null && current.uses >= current.maxUses) {
        return { status: "EXHAUSTED" };
      }
      return { status: "CONFLICT" };
    }

    await tx.auditEvent.create({
      data: {
        actorUserId: input.actorUserId,
        agentId: input.agentId,
        ownerType: grant.agent.ownerType,
        ownerId:
          grant.agent.ownerType === "USER"
            ? grant.agent.userOwnerId
            : grant.agent.organizationOwnerId,
        action: "permission_grant.use_consumed",
        targetType: "PermissionGrant",
        targetId: input.grantId,
        outcome: "COMPLETED",
        policyVersion: String(grant.version),
        correlationId,
        metadata: {
          action: input.action,
          target: input.target,
          dataScope: input.dataScope,
        },
      },
    });

    return { status: "CONSUMED", uses: grant.uses + 1, correlationId };
  });
}
