import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { POST } from "../../app/api/admin/invitations/route";

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
const adminId = `invitation-admin-${suffix}`;
const memberId = `invitation-member-${suffix}`;
const organizationId = `invitation-org-${suffix}`;

const setSessionUser = (userId: string | null) => {
  vi.mocked(auth.api.getSession).mockResolvedValue(
    userId ? ({ user: { id: userId } } as never) : null,
  );
};

const createRequest = (body: unknown) =>
  new Request("http://localhost/api/admin/invitations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost",
    },
    body: JSON.stringify(body),
  });

suite("admin invitation API authorization and secret handling (PostgreSQL integration)", () => {
  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        {
          id: adminId,
          name: "Invitation Platform Admin",
          email: `invitation-admin-${suffix}@example.invalid`,
          platformRole: "PLATFORM_ADMIN",
        },
        {
          id: memberId,
          name: "Invitation Ordinary Member",
          email: `invitation-member-${suffix}@example.invalid`,
          platformRole: "MEMBER",
        },
      ],
    });
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "Invitation Target Organization",
        slug: `invitation-target-${suffix}`,
      },
    });
  });

  afterAll(async () => {
    const created = await prisma.invitation.findMany({
      where: { createdById: adminId },
      select: { id: true },
    });
    const ids = created.map((item) => item.id);
    await prisma.auditEvent.deleteMany({
      where: { targetType: "Invitation", targetId: { in: ids } },
    });
    await prisma.invitation.deleteMany({ where: { id: { in: ids } } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: { in: [adminId, memberId] } } });
    vi.mocked(auth.api.getSession).mockReset();
  });

  it("rejects unauthenticated callers", async () => {
    setSessionUser(null);
    const response = await POST(createRequest({}),);
    expect(response.status).toBe(401);
  });

  it("rejects authenticated users without the platform-admin role", async () => {
    setSessionUser(memberId);
    const response = await POST(createRequest({}));
    expect(response.status).toBe(403);
    await expect(
      prisma.invitation.count({ where: { createdById: memberId } }),
    ).resolves.toBe(0);
  });

  it("stores only a token hash and returns a one-time redemption token to platform admins", async () => {
    setSessionUser(adminId);
    const response = await POST(
      createRequest({ email: "  Buyer@Example.COM ", expiresInHours: 2 }),
    );

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.data).toMatchObject({
      intendedEmail: "buyer@example.com",
      status: "PENDING",
    });
    expect(typeof payload.data.token).toBe("string");
    expect(payload.data.token.length).toBeGreaterThan(30);
    expect(payload.data.redemptionUrl).toContain(
      `#token=${payload.data.token}`,
    );

    const tokenHash = createHash("sha256")
      .update(payload.data.token)
      .digest("hex");
    const stored = await prisma.invitation.findUniqueOrThrow({
      where: { id: payload.data.id },
    });
    expect(stored.tokenHash).toBe(tokenHash);
    expect(stored.tokenHash).not.toBe(payload.data.token);
    expect(stored.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(stored.expiresAt.getTime()).toBeLessThanOrEqual(
      Date.now() + 2 * 60 * 60 * 1000 + 5000,
    );

    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: {
        targetType: "Invitation",
        targetId: payload.data.id,
        actorUserId: adminId,
        action: "invitation.created",
      },
    });
    expect(audit.metadata).not.toHaveProperty("token");
    expect(audit.metadata).not.toHaveProperty("tokenHash");
  });


  it("creates organization-scoped invitations with a bounded non-owner role", async () => {
    setSessionUser(adminId);
    const response = await POST(
      createRequest({
        email: "team@example.com",
        organizationId,
        role: "AGENT_MANAGER",
        expiresInHours: 24,
      }),
    );
    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.data).toMatchObject({
      organizationId,
      role: "AGENT_MANAGER",
      intendedEmail: "team@example.com",
    });
    const stored = await prisma.invitation.findUniqueOrThrow({
      where: { id: payload.data.id },
      select: { organizationId: true, role: true },
    });
    expect(stored).toEqual({ organizationId, role: "AGENT_MANAGER" });
  });

  it("rejects organization invitations without a role and does not allow OWNER assignment", async () => {
    setSessionUser(adminId);
    const missingRole = await POST(
      createRequest({ organizationId }),
    );
    const ownerRole = await POST(
      createRequest({ organizationId, role: "OWNER" }),
    );
    expect(missingRole.status).toBe(422);
    expect(ownerRole.status).toBe(422);
  });

  it("rejects invalid invitation payloads without creating records", async () => {
    setSessionUser(adminId);
    const response = await POST(
      createRequest({ email: "not-an-email", expiresInHours: 999 }),
    );
    expect(response.status).toBe(422);
  });
});
