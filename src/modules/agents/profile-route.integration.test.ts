import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { PATCH as updateProfile } from "../../app/api/v1/agents/[agentId]/route";

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
const ownerId = `profile-owner-${suffix}`;
const outsiderId = `profile-outsider-${suffix}`;
const managerId = `profile-manager-${suffix}`;
const orgId = `profile-org-${suffix}`;
const personalAgentId = `profile-personal-${suffix}`;
const orgAgentId = `profile-org-agent-${suffix}`;
const revokedAgentId = `profile-revoked-${suffix}`;

const setSessionUser = (userId: string | null) => {
  vi.mocked(auth.api.getSession).mockResolvedValue(
    userId ? ({ user: { id: userId } } as never) : null,
  );
};
const context = (agentId: string) => ({ params: Promise.resolve({ agentId }) });
const patchRequest = (body: unknown) => new Request("http://localhost/api/v1/agents/profile", {
  method: "PATCH",
  headers: { "Content-Type": "application/json", Origin: "http://localhost" },
  body: JSON.stringify(body),
});

suite("agent profile management (PostgreSQL integration)", () => {
  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: ownerId, name: "Profile Owner", email: `profile-owner-${suffix}@example.invalid` },
        { id: outsiderId, name: "Profile Outsider", email: `profile-outsider-${suffix}@example.invalid` },
        { id: managerId, name: "Profile Manager", email: `profile-manager-${suffix}@example.invalid` },
      ],
    });
    await prisma.organization.create({
      data: { id: orgId, name: "Profile Test Organization", slug: `profile-${suffix}` },
    });
    await prisma.membership.create({
      data: { organizationId: orgId, userId: managerId, role: "AGENT_MANAGER" },
    });
    await prisma.agent.createMany({
      data: [
        {
          id: personalAgentId, ownerType: "USER", userOwnerId: ownerId,
          name: "Personal agent", purpose: "Original purpose", status: "DRAFT",
        },
        {
          id: orgAgentId, ownerType: "ORGANIZATION", organizationOwnerId: orgId,
          name: "Organization agent", purpose: "Original purpose", status: "DRAFT",
        },
        {
          id: revokedAgentId, ownerType: "USER", userOwnerId: ownerId,
          name: "Revoked agent", purpose: "Terminal purpose", status: "REVOKED",
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.auditEvent.deleteMany({
      where: { agentId: { in: [personalAgentId, orgAgentId, revokedAgentId] } },
    });
    await prisma.agent.deleteMany({
      where: { id: { in: [personalAgentId, orgAgentId, revokedAgentId] } },
    });
    await prisma.membership.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, outsiderId, managerId] } } });
    vi.mocked(auth.api.getSession).mockReset();
  });

  it("requires authentication and enforces ownership boundaries", async () => {
    const payload = { configurationVersion: 1, name: "Updated name" };
    setSessionUser(null);
    expect((await updateProfile(patchRequest(payload), context(personalAgentId))).status).toBe(401);
    setSessionUser(outsiderId);
    expect((await updateProfile(patchRequest(payload), context(personalAgentId))).status).toBe(403);
  });

  it("allows the owner to update a profile with optimistic concurrency and audit", async () => {
    setSessionUser(ownerId);
    const response = await updateProfile(
      patchRequest({
        configurationVersion: 1,
        name: "Updated personal agent",
        purpose: "A more precise personal workflow.",
        primaryLanguage: "ar",
        supportedLanguages: ["ar", "en"],
      }),
      context(personalAgentId),
    );
    expect(response.status).toBe(200);
    const saved = await prisma.agent.findUniqueOrThrow({
      where: { id: personalAgentId },
      select: { name: true, purpose: true, configurationVersion: true },
    });
    expect(saved).toMatchObject({
      name: "Updated personal agent",
      purpose: "A more precise personal workflow.",
      configurationVersion: 2,
    });
    expect(await prisma.auditEvent.count({
      where: { agentId: personalAgentId, action: "agent.profile.updated", actorUserId: ownerId },
    })).toBe(1);

    const stale = await updateProfile(
      patchRequest({ configurationVersion: 1, name: "Stale overwrite" }),
      context(personalAgentId),
    );
    expect(stale.status).toBe(409);

    const invalidLanguage = await updateProfile(
      patchRequest({ configurationVersion: 2, supportedLanguages: ["ar"], primaryLanguage: "en" }),
      context(personalAgentId),
    );
    expect(invalidLanguage.status).toBe(422);
    const unchanged = await prisma.agent.findUniqueOrThrow({
      where: { id: personalAgentId },
      select: { primaryLanguage: true, supportedLanguages: true, configurationVersion: true },
    });
    expect(unchanged).toMatchObject({
      primaryLanguage: "ar",
      supportedLanguages: ["ar", "en"],
      configurationVersion: 2,
    });
  });

  it("allows organization agent managers but rejects revoked agents", async () => {
    setSessionUser(managerId);
    const organizationUpdate = await updateProfile(
      patchRequest({ configurationVersion: 1, publicDescription: "A safe public description." }),
      context(orgAgentId),
    );
    expect(organizationUpdate.status).toBe(200);

    setSessionUser(ownerId);
    const revokedUpdate = await updateProfile(
      patchRequest({ configurationVersion: 1, name: "Must not change" }),
      context(revokedAgentId),
    );
    expect(revokedUpdate.status).toBe(409);
  });

  it("rejects unknown fields and empty profile changes", async () => {
    setSessionUser(ownerId);
    const unknown = await updateProfile(
      patchRequest({ configurationVersion: 1, status: "ACTIVE" }),
      context(personalAgentId),
    );
    const empty = await updateProfile(
      patchRequest({ configurationVersion: 1 }),
      context(personalAgentId),
    );
    expect(unknown.status).toBe(422);
    expect(empty.status).toBe(422);
  });
});
