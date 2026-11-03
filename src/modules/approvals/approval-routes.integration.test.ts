import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import {
  GET as listApprovalRequests,
  POST as createApprovalRequest,
} from "../../app/api/v1/agents/[agentId]/approvals/route";
import { PATCH as decideApproval } from "../../app/api/v1/approvals/[approvalId]/decision/route";

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
const ownerId = `approval-owner-${suffix}`;
const adminId = `approval-admin-${suffix}`;
const managerId = `approval-manager-${suffix}`;
const viewerId = `approval-viewer-${suffix}`;
const outsiderId = `approval-outsider-${suffix}`;
const organizationId = `approval-org-${suffix}`;
const agentId = `approval-agent-${suffix}`;

const setSessionUser = (userId: string) => {
  vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: userId } } as never);
};

const agentContext = { params: Promise.resolve({ agentId }) };
const decisionContext = (approvalId: string) => ({
  params: Promise.resolve({ approvalId }),
});

const postRequest = (body: unknown) =>
  new Request("http://localhost/api/v1/agents/approvals", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost" },
    body: JSON.stringify(body),
  });

const patchRequest = (body: unknown) =>
  new Request("http://localhost/api/v1/approvals/decision", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Origin: "http://localhost" },
    body: JSON.stringify(body),
  });

async function createGrant(key: string) {
  return prisma.permissionGrant.create({
    data: {
      id: `approval-grant-${key}-${suffix}`,
      agentId,
      purpose: "Controlled supplier messaging after human review",
      actionScope: ["SEND_MESSAGE"],
      targetScope: ["agent://target-1"],
      dataScope: ["PUBLIC_PROFILE", "CONTACT"],
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      maxUses: 5,
    },
  });
}

async function submitApproval(grantId: string, idempotencyKey: string, payload: Record<string, unknown> = { message: "Hello", apiKey: "sensitive-value" }) {
  setSessionUser(adminId);
  return createApprovalRequest(
    postRequest({
      grantId,
      actionType: "SEND_MESSAGE",
      recipient: "agent://target-1",
      requestedDataScope: ["PUBLIC_PROFILE"],
      payload,
      expiresInMinutes: 30,
      idempotencyKey,
    }),
    agentContext,
  );
}

suite("exact-payload action approval workflow (PostgreSQL integration)", () => {
  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: ownerId, name: "Approval Owner", email: `approval-owner-${suffix}@example.invalid` },
        { id: adminId, name: "Approval Admin", email: `approval-admin-${suffix}@example.invalid` },
        { id: managerId, name: "Approval Manager", email: `approval-manager-${suffix}@example.invalid` },
        { id: viewerId, name: "Approval Viewer", email: `approval-viewer-${suffix}@example.invalid` },
        { id: outsiderId, name: "Approval Outsider", email: `approval-outsider-${suffix}@example.invalid` },
      ],
    });
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "Approval Test Organization",
        slug: `approval-${suffix}`,
      },
    });
    await prisma.membership.createMany({
      data: [
        { organizationId, userId: ownerId, role: "OWNER" },
        { organizationId, userId: adminId, role: "ADMIN" },
        { organizationId, userId: managerId, role: "AGENT_MANAGER" },
        { organizationId, userId: viewerId, role: "VIEWER" },
      ],
    });
    await prisma.agent.create({
      data: {
        id: agentId,
        ownerType: "ORGANIZATION",
        organizationOwnerId: organizationId,
        name: "Approval Test Agent",
        purpose: "Test controlled action approval.",
        status: "ACTIVE",
      },
    });
  });

  afterAll(async () => {
    await prisma.auditEvent.deleteMany({ where: { ownerId: organizationId } });
    await prisma.actionApproval.deleteMany({ where: { agentId } });
    await prisma.permissionGrant.deleteMany({ where: { agentId } });
    await prisma.agent.deleteMany({ where: { id: agentId } });
    await prisma.membership.deleteMany({ where: { organizationId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({
      where: { id: { in: [ownerId, adminId, managerId, viewerId, outsiderId] } },
    });
    vi.mocked(auth.api.getSession).mockReset();
  });

  it("requires an authorized requester and validates grant scopes before creating an approval", async () => {
    const grant = await createGrant("scope-denied");
    setSessionUser(outsiderId);
    const outsider = await createApprovalRequest(
      postRequest({
        grantId: grant.id,
        actionType: "SEND_MESSAGE",
        recipient: "agent://target-1",
        requestedDataScope: ["PUBLIC_PROFILE"],
        payload: { message: "hello" },
        idempotencyKey: `outsider-${suffix}`,
      }),
      agentContext,
    );
    expect(outsider.status).toBe(403);

    setSessionUser(managerId);
    const manager = await createApprovalRequest(
      postRequest({
        grantId: grant.id,
        actionType: "SEND_MESSAGE",
        recipient: "agent://target-1",
        requestedDataScope: ["PUBLIC_PROFILE"],
        payload: { message: "hello" },
        idempotencyKey: "manager-request-denied",
      }),
      agentContext,
    );
    expect(manager.status).toBe(403);

    const badScopeGrant = await prisma.permissionGrant.create({
      data: {
        id: `approval-grant-bad-${suffix}`,
        agentId,
        purpose: "Wrong action scope",
        actionScope: ["READ_PROFILE"],
        targetScope: ["agent://target-1"],
        dataScope: ["PUBLIC_PROFILE"],
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    setSessionUser(adminId);
    const denied = await createApprovalRequest(
      postRequest({
        grantId: badScopeGrant.id,
        actionType: "SEND_MESSAGE",
        recipient: "agent://target-1",
        requestedDataScope: ["PUBLIC_PROFILE"],
        payload: { message: "hello" },
        idempotencyKey: `bad-scope-${suffix}`,
      }),
      agentContext,
    );
    expect(denied.status).toBe(403);
  });

  it("creates a digest-bound request, redacts preview secrets, and enforces idempotency", async () => {
    const grant = await createGrant("idempotency");
    const key = `approval-key-${suffix}`;
    const first = await submitApproval(grant.id, key);
    expect(first.status).toBe(201);
    const firstPayload = await first.json();
    expect(firstPayload.data.status).toBe("PENDING");
    expect(firstPayload.data.payloadDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(firstPayload.data.payloadPreview.apiKey).toBe("[REDACTED]");

    const repeated = await submitApproval(grant.id, key);
    expect(repeated.status).toBe(200);
    const repeatedPayload = await repeated.json();
    expect(repeatedPayload.data.id).toBe(firstPayload.data.id);

    const conflict = await submitApproval(grant.id, key, { message: "Different payload" });
    expect(conflict.status).toBe(409);

    const stored = await prisma.actionApproval.findUniqueOrThrow({
      where: { id: firstPayload.data.id },
    });
    expect(stored.payloadDigest).toBe(firstPayload.data.payloadDigest);
    expect(stored.approvalDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.status).toBe("PENDING");
    await expect(
      prisma.auditEvent.count({
        where: {
          ownerId: organizationId,
          action: "action_approval.requested",
          targetId: stored.id,
          actorUserId: adminId,
        },
      }),
    ).resolves.toBe(1);
  });

  it("allows the owner to approve but forbids self-approval and manager decisions", async () => {
    const grant = await createGrant("approve");
    const response = await submitApproval(grant.id, `approve-key-${suffix}`);
    const payload = await response.json();
    const approvalId = payload.data.id;

    setSessionUser(adminId);
    const selfApproval = await decideApproval(
      patchRequest({ decision: "APPROVE" }),
      decisionContext(approvalId),
    );
    expect(selfApproval.status).toBe(403);

    setSessionUser(viewerId);
    const viewerDecision = await decideApproval(
      patchRequest({ decision: "APPROVE" }),
      decisionContext(approvalId),
    );
    expect(viewerDecision.status).toBe(403);

    setSessionUser(ownerId);
    const approved = await decideApproval(
      patchRequest({ decision: "APPROVE", reason: "Reviewed exact action digest and recipient." }),
      decisionContext(approvalId),
    );
    expect(approved.status).toBe(200);
    const stored = await prisma.actionApproval.findUniqueOrThrow({
      where: { id: approvalId },
      select: { status: true, approverUserId: true, approvedAt: true, version: true },
    });
    expect(stored.status).toBe("APPROVED");
    expect(stored.approverUserId).toBe(ownerId);
    expect(stored.approvedAt).not.toBeNull();
    expect(stored.version).toBe(2);

    const replay = await decideApproval(
      patchRequest({ decision: "APPROVE" }),
      decisionContext(approvalId),
    );
    expect(replay.status).toBe(409);
  });

  it("allows an organization admin to reject a request with an audit record", async () => {
    const grant = await createGrant("reject");
    const response = await submitApproval(grant.id, `reject-key-${suffix}`);
    const payload = await response.json();

    setSessionUser(adminId);
    const rejected = await decideApproval(
      patchRequest({ decision: "REJECT", reason: "Recipient is not approved." }),
      decisionContext(payload.data.id),
    );
    expect(rejected.status).toBe(200);
    const stored = await prisma.actionApproval.findUniqueOrThrow({
      where: { id: payload.data.id },
      select: { status: true, approverUserId: true, rejectedAt: true, decisionReason: true },
    });
    expect(stored).toEqual({
      status: "REJECTED",
      approverUserId: adminId,
      rejectedAt: expect.any(Date),
      decisionReason: "Recipient is not approved.",
    });
  });

  it("expires stale requests and cancels requests whose grants are revoked", async () => {
    const expiredGrant = await createGrant("expired");
    const expiredResponse = await submitApproval(expiredGrant.id, `expired-key-${suffix}`);
    const expiredPayload = await expiredResponse.json();
    await prisma.actionApproval.update({
      where: { id: expiredPayload.data.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    setSessionUser(ownerId);
    const expiredDecision = await decideApproval(
      patchRequest({ decision: "APPROVE" }),
      decisionContext(expiredPayload.data.id),
    );
    expect(expiredDecision.status).toBe(200);
    const expiredStored = await prisma.actionApproval.findUniqueOrThrow({
      where: { id: expiredPayload.data.id },
      select: { status: true },
    });
    expect(expiredStored.status).toBe("EXPIRED");

    const revokedGrant = await createGrant("revoked");
    const revokedResponse = await submitApproval(revokedGrant.id, `revoked-key-${suffix}`);
    const revokedPayload = await revokedResponse.json();
    await prisma.permissionGrant.update({
      where: { id: revokedGrant.id },
      data: { status: "REVOKED", revokedAt: new Date(), version: { increment: 1 } },
    });
    const cancelledDecision = await decideApproval(
      patchRequest({ decision: "APPROVE" }),
      decisionContext(revokedPayload.data.id),
    );
    expect(cancelledDecision.status).toBe(200);
    const cancelledStored = await prisma.actionApproval.findUniqueOrThrow({
      where: { id: revokedPayload.data.id },
      select: { status: true, decisionReason: true },
    });
    expect(cancelledStored).toEqual({
      status: "CANCELLED",
      decisionReason: "GRANT_NO_LONGER_VALID",
    });
  });

  it("cancels a request if its stored approval digest no longer matches", async () => {
    const grant = await createGrant("tamper");
    const response = await submitApproval(grant.id, `tamper-key-${suffix}`);
    const payload = await response.json();
    await prisma.actionApproval.update({
      where: { id: payload.data.id },
      data: { approvalDigest: "0".repeat(64) },
    });

    setSessionUser(ownerId);
    const decision = await decideApproval(
      patchRequest({ decision: "APPROVE" }),
      decisionContext(payload.data.id),
    );
    expect(decision.status).toBe(200);
    const stored = await prisma.actionApproval.findUniqueOrThrow({
      where: { id: payload.data.id },
      select: { status: true, decisionReason: true },
    });
    expect(stored).toEqual({
      status: "CANCELLED",
      decisionReason: "APPROVAL_DIGEST_MISMATCH",
    });
  });

  it("restricts approval queue access to owners and admins", async () => {
    const grant = await createGrant("queue");
    const response = await submitApproval(grant.id, `queue-key-${suffix}`);
    expect(response.status).toBe(201);

    setSessionUser(managerId);
    const managerList = await listApprovalRequests(
      new Request("http://localhost"),
      agentContext,
    );
    expect(managerList.status).toBe(403);

    setSessionUser(ownerId);
    const ownerList = await listApprovalRequests(
      new Request("http://localhost"),
      agentContext,
    );
    expect(ownerList.status).toBe(200);
    const ownerPayload = await ownerList.json();
    expect(ownerPayload.data.some((item: { requester: { id: string } }) =>
      item.requester.id === adminId,
    )).toBe(true);
  }); 
  it("serializes concurrent idempotent request creation", async () => {
    const grant = await createGrant("concurrent-idempotency");
    const key = `concurrent-key-${suffix}`;
    const [first, second] = await Promise.all([
      submitApproval(grant.id, key),
      submitApproval(grant.id, key),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 201]);
    await expect(
      prisma.actionApproval.count({ where: { idempotencyKey: key } }),
    ).resolves.toBe(1);
  });

  it("allows exactly one concurrent approval decision", async () => {
    const grant = await createGrant("concurrent-decision");
    const response = await submitApproval(grant.id, `concurrent-decision-key-${suffix}`);
    const payload = await response.json();

    setSessionUser(ownerId);
    const decisions = await Promise.all([
      decideApproval(
        patchRequest({ decision: "APPROVE" }),
        decisionContext(payload.data.id),
      ),
      decideApproval(
        patchRequest({ decision: "APPROVE" }),
        decisionContext(payload.data.id),
      ),
    ]);
    expect(decisions.map((item) => item.status).sort()).toEqual([200, 409]);
    await expect(
      prisma.auditEvent.count({
        where: {
          ownerId: organizationId,
          action: "action_approval.approved",
          targetId: payload.data.id,
        },
      }),
    ).resolves.toBe(1);
  });

  it("cancels pending approvals when the agent is paused", async () => {
    const grant = await createGrant("agent-paused");
    const response = await submitApproval(grant.id, `paused-agent-key-${suffix}`);
    const payload = await response.json();
    await prisma.agent.update({
      where: { id: agentId },
      data: { status: "PAUSED" },
    });

    setSessionUser(ownerId);
    const decision = await decideApproval(
      patchRequest({ decision: "APPROVE" }),
      decisionContext(payload.data.id),
    );
    expect(decision.status).toBe(200);
    const stored = await prisma.actionApproval.findUniqueOrThrow({
      where: { id: payload.data.id },
      select: { status: true, decisionReason: true },
    });
    expect(stored).toEqual({
      status: "CANCELLED",
      decisionReason: "AGENT_NOT_ACTIVE",
    });
    await prisma.agent.update({
      where: { id: agentId },
      data: { status: "ACTIVE" },
    });
  });

});
