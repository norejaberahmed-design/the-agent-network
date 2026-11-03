import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { completeInvitationRedemption } from "./complete-redemption";

const enabled = process.env.RUN_DB_INTEGRATION === "1";
const suite = enabled ? describe : describe.skip;
const suffix = randomUUID();
const adminId = `redemption-admin-${suffix}`;
const userId = `redemption-user-${suffix}`;
const userEmail = `redemption-user-${suffix}@example.invalid`;
const raceUserId = `redemption-race-user-${suffix}`;
const raceUserEmail = `redemption-race-user-${suffix}@example.invalid`;
const organizationId = `redemption-org-${suffix}`;

suite("invitation redemption transaction (PostgreSQL integration)", () => {
  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        {
          id: adminId,
          name: "Redemption Test Admin",
          email: `redemption-admin-${suffix}@example.invalid`,
          platformRole: "PLATFORM_ADMIN",
        },
        {
          id: userId,
          name: "Redemption Test User",
          email: userEmail,
        },
        {
          id: raceUserId,
          name: "Redemption Race Test User",
          email: raceUserEmail,
        },
      ],
    });
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "Redemption Test Organization",
        slug: `redemption-org-${suffix}`,
      },
    });
  });

  afterAll(async () => {
    const invitations = await prisma.invitation.findMany({
      where: { createdById: adminId },
      select: { id: true },
    });
    const invitationIds = invitations.map((invitation) => invitation.id);
    await prisma.auditEvent.deleteMany({
      where: { targetType: "Invitation", targetId: { in: invitationIds } },
    });
    await prisma.membership.deleteMany({ where: { organizationId } });
    await prisma.invitation.deleteMany({ where: { createdById: adminId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: { in: [adminId, userId, raceUserId] } } });
  });

  async function createReservedInvitation(options?: {
    organizationId?: string | null;
    role?: "ADMIN" | "AGENT_MANAGER" | "OPERATOR" | "AUDITOR" | "VIEWER" | null;
    intendedEmail?: string | null;
    reservationExpiresAt?: Date;
  }) {
    const tokenHash = randomUUID().replace(/-/g, "").padEnd(64, "a");
    const reservationId = randomUUID();
    const invitation = await prisma.invitation.create({
      data: {
        tokenHash,
        intendedEmail: options?.intendedEmail === undefined ? userEmail : options.intendedEmail,
        organizationId: options?.organizationId === undefined
          ? organizationId
          : options.organizationId,
        role: options?.role === undefined ? "AGENT_MANAGER" : options.role,
        status: "RESERVED",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        reservationId,
        reservationExpiresAt: options?.reservationExpiresAt ??
          new Date(Date.now() + 5 * 60 * 1000),
        createdById: adminId,
      },
    });
    return { invitation, tokenHash, reservationId };
  }

  it("redeems an organization invitation and grants its role in the same transaction", async () => {
    const fixture = await createReservedInvitation();
    const result = await completeInvitationRedemption({
      tokenHash: fixture.tokenHash,
      reservationId: fixture.reservationId,
      userId,
      email: userEmail.toUpperCase(),
    });

    expect(result).toMatchObject({
      invitationId: fixture.invitation.id,
      organizationId,
      role: "AGENT_MANAGER",
    });
    const [invitation, membership, auditCount] = await Promise.all([
      prisma.invitation.findUniqueOrThrow({ where: { id: fixture.invitation.id } }),
      prisma.membership.findUniqueOrThrow({
        where: { organizationId_userId: { organizationId, userId } },
      }),
      prisma.auditEvent.count({
        where: {
          targetId: fixture.invitation.id,
          action: "invitation.redeemed",
          actorUserId: userId,
        },
      }),
    ]);
    expect(invitation.status).toBe("REDEEMED");
    expect(invitation.reservationId).toBeNull();
    expect(membership.role).toBe("AGENT_MANAGER");
    expect(auditCount).toBe(1);
  });

  it("allows exactly one successful redemption when the same reservation races", async () => {
    const fixture = await createReservedInvitation({ intendedEmail: raceUserEmail });
    const attempts = await Promise.allSettled([
      completeInvitationRedemption({
        tokenHash: fixture.tokenHash,
        reservationId: fixture.reservationId,
        userId: raceUserId,
        email: raceUserEmail,
      }),
      completeInvitationRedemption({
        tokenHash: fixture.tokenHash,
        reservationId: fixture.reservationId,
        userId: raceUserId,
        email: raceUserEmail,
      }),
    ]);

    expect(attempts.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((item) => item.status === "rejected")).toHaveLength(1);
    expect(
      await prisma.auditEvent.count({
        where: {
          targetId: fixture.invitation.id,
          action: "invitation.redeemed",
        },
      }),
    ).toBe(1);
  });

  it("does not redeem invitations with expired reservations", async () => {
    const fixture = await createReservedInvitation({
      reservationExpiresAt: new Date(Date.now() - 1000),
    });
    await expect(
      completeInvitationRedemption({
        tokenHash: fixture.tokenHash,
        reservationId: fixture.reservationId,
        userId: raceUserId,
        email: raceUserEmail,
      }),
    ).rejects.toThrow("reservation is no longer valid");

    const invitation = await prisma.invitation.findUniqueOrThrow({
      where: { id: fixture.invitation.id },
    });
    expect(invitation.status).toBe("RESERVED");
    expect(invitation.redeemedAt).toBeNull();
  });

  it("rejects a mismatched email without consuming the invitation", async () => {
    const fixture = await createReservedInvitation();
    await expect(
      completeInvitationRedemption({
        tokenHash: fixture.tokenHash,
        reservationId: fixture.reservationId,
        userId: raceUserId,
        email: "attacker@example.invalid",
      }),
    ).rejects.toThrow("assigned to another email");

    const invitation = await prisma.invitation.findUniqueOrThrow({
      where: { id: fixture.invitation.id },
    });
    expect(invitation.status).toBe("RESERVED");
  });

  it("redeems a global invitation without creating an organization membership", async () => {
    const fixture = await createReservedInvitation({
      organizationId: null,
      role: null,
    });
    const membershipsBefore = await prisma.membership.count({
      where: { organizationId, userId },
    });
    await completeInvitationRedemption({
      tokenHash: fixture.tokenHash,
      reservationId: fixture.reservationId,
      userId: raceUserId,
      email: raceUserEmail,
    });

    expect(
      await prisma.membership.count({
        where: { organizationId, userId },
      }),
    ).toBe(membershipsBefore);
    const invitation = await prisma.invitation.findUniqueOrThrow({
      where: { id: fixture.invitation.id },
    });
    expect(invitation.status).toBe("REDEEMED");
  });
});
