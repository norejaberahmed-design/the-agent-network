import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { GET } from "./route";

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

const enabled = process.env.RUN_DB_INTEGRATION === "1";
const suite = enabled ? describe : describe.skip;
const suffix = randomUUID();
const ownerId = `api-owner-${suffix}`;
const viewerId = `api-viewer-${suffix}`;
const outsiderId = `api-outsider-${suffix}`;
const organizationId = `api-organization-${suffix}`;
const agentId = `api-agent-${suffix}`;

const setSessionUser = (userId: string) => {
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: userId },
  } as never);
};

const callListRoute = () =>
  GET(new Request(`http://localhost/api/v1/organizations/${organizationId}/agents`), {
    params: Promise.resolve({ organizationId }),
  });

suite("organization agents API authorization (PostgreSQL integration)", () => {
  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: ownerId, name: "API Tenant Owner", email: `api-owner-${suffix}@example.invalid` },
        { id: viewerId, name: "API Tenant Viewer", email: `api-viewer-${suffix}@example.invalid` },
        { id: outsiderId, name: "API Tenant Outsider", email: `api-outsider-${suffix}@example.invalid` },
      ],
    });
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "API Tenant Organization",
        slug: `api-tenant-${suffix}`,
      },
    });
    await prisma.membership.createMany({
      data: [
        { organizationId, userId: ownerId, role: "OWNER" },
        { organizationId, userId: viewerId, role: "VIEWER" },
      ],
    });
    await prisma.agent.create({
      data: {
        id: agentId,
        ownerType: "ORGANIZATION",
        organizationOwnerId: organizationId,
        name: "API Tenant Agent",
        publicDescription: "Public summary for authorized members",
        purpose: "Private internal purpose for authorized non-viewer members",
      },
    });
  });

  afterAll(async () => {
    await prisma.agent.deleteMany({ where: { id: agentId } });
    await prisma.membership.deleteMany({ where: { organizationId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, viewerId, outsiderId] } } });
    vi.mocked(auth.api.getSession).mockReset();
  });

  it("returns 403 for a user outside the organization", async () => {
    setSessionUser(outsiderId);
    const response = await callListRoute();
    expect(response.status).toBe(403);
  });

  it("returns only the restricted projection to a VIEWER", async () => {
    setSessionUser(viewerId);
    const response = await callListRoute();
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data).toHaveLength(1);
    expect(payload.data[0]).toMatchObject({
      id: agentId,
      name: "API Tenant Agent",
      status: "DRAFT",
    });
    expect(payload.data[0]).not.toHaveProperty("purpose");
    expect(payload.data[0]).not.toHaveProperty("publicDescription");
  });

  it("returns private purpose only to an authorized non-viewer member", async () => {
    setSessionUser(ownerId);
    const response = await callListRoute();
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data[0].purpose).toBe("Private internal purpose for authorized non-viewer members");
  });
});
