-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."MembershipRole" AS ENUM ('OWNER', 'ADMIN', 'AGENT_MANAGER', 'OPERATOR', 'AUDITOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "public"."AgentOwnerType" AS ENUM ('USER', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "public"."AgentStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'SUSPENDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "public"."DataClassification" AS ENUM ('PUBLIC', 'CONTEXTUAL', 'PRIVATE', 'HIGHLY_SENSITIVE');

-- CreateEnum
CREATE TYPE "public"."GrantStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "public"."InvitationStatus" AS ENUM ('PENDING', 'RESERVED', 'REDEEMED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "public"."AuditOutcome" AS ENUM ('ALLOWED', 'DENIED', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CONSUMED', 'CANCELLED');

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "platformRole" TEXT NOT NULL DEFAULT 'MEMBER',
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Membership" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "public"."MembershipRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Invitation" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "intendedEmail" TEXT,
    "organizationId" TEXT,
    "role" "public"."MembershipRole",
    "status" "public"."InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "redeemedAt" TIMESTAMP(3),
    "reservationId" TEXT,
    "reservationExpiresAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Agent" (
    "id" TEXT NOT NULL,
    "ownerType" "public"."AgentOwnerType" NOT NULL,
    "userOwnerId" TEXT,
    "organizationOwnerId" TEXT,
    "name" TEXT NOT NULL,
    "publicDescription" TEXT,
    "purpose" TEXT NOT NULL,
    "primaryLanguage" TEXT NOT NULL DEFAULT 'ar',
    "supportedLanguages" TEXT[] DEFAULT ARRAY['ar', 'en']::TEXT[],
    "discoverable" BOOLEAN NOT NULL DEFAULT false,
    "status" "public"."AgentStatus" NOT NULL DEFAULT 'DRAFT',
    "configurationVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AgentCapability" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentCapability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AgentFieldPolicy" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "classification" "public"."DataClassification" NOT NULL,
    "publicVisible" BOOLEAN NOT NULL DEFAULT false,
    "allowedPurposes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowedAudiences" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "retentionDays" INTEGER,
    "policyVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentFieldPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PermissionGrant" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "actionScope" TEXT[],
    "targetScope" TEXT[],
    "dataScope" TEXT[],
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "maxUses" INTEGER,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "public"."GrantStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "PermissionGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ActionApproval" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "organizationId" TEXT,
    "grantId" TEXT NOT NULL,
    "requesterUserId" TEXT NOT NULL,
    "approverUserId" TEXT,
    "actionType" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "requestedDataScope" TEXT[],
    "payloadDigest" VARCHAR(64) NOT NULL,
    "approvalDigest" VARCHAR(64) NOT NULL,
    "payloadPreview" JSONB NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "public"."ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "decisionReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActionApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AuditEvent" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "agentId" TEXT,
    "ownerType" "public"."AgentOwnerType",
    "ownerId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "outcome" "public"."AuditOutcome" NOT NULL,
    "policyVersion" TEXT,
    "correlationId" TEXT NOT NULL,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "public"."Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "public"."Session"("userId");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "public"."Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_providerId_accountId_key" ON "public"."Account"("providerId", "accountId");

-- CreateIndex
CREATE INDEX "Verification_identifier_idx" ON "public"."Verification"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "public"."Organization"("slug");

-- CreateIndex
CREATE INDEX "Membership_userId_role_idx" ON "public"."Membership"("userId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_organizationId_userId_key" ON "public"."Membership"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "public"."Invitation"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_reservationId_key" ON "public"."Invitation"("reservationId");

-- CreateIndex
CREATE INDEX "Invitation_status_expiresAt_idx" ON "public"."Invitation"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "Invitation_intendedEmail_idx" ON "public"."Invitation"("intendedEmail");

-- CreateIndex
CREATE INDEX "Agent_ownerType_userOwnerId_idx" ON "public"."Agent"("ownerType", "userOwnerId");

-- CreateIndex
CREATE INDEX "Agent_ownerType_organizationOwnerId_idx" ON "public"."Agent"("ownerType", "organizationOwnerId");

-- CreateIndex
CREATE INDEX "Agent_status_discoverable_idx" ON "public"."Agent"("status", "discoverable");

-- CreateIndex
CREATE UNIQUE INDEX "AgentCapability_agentId_key_key" ON "public"."AgentCapability"("agentId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "AgentFieldPolicy_agentId_fieldKey_key" ON "public"."AgentFieldPolicy"("agentId", "fieldKey");

-- CreateIndex
CREATE INDEX "PermissionGrant_agentId_status_expiresAt_idx" ON "public"."PermissionGrant"("agentId", "status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ActionApproval_idempotencyKey_key" ON "public"."ActionApproval"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ActionApproval_agentId_status_expiresAt_idx" ON "public"."ActionApproval"("agentId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "ActionApproval_organizationId_status_expiresAt_idx" ON "public"."ActionApproval"("organizationId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "ActionApproval_grantId_status_idx" ON "public"."ActionApproval"("grantId", "status");

-- CreateIndex
CREATE INDEX "ActionApproval_requesterUserId_status_idx" ON "public"."ActionApproval"("requesterUserId", "status");

-- CreateIndex
CREATE INDEX "ActionApproval_approverUserId_status_idx" ON "public"."ActionApproval"("approverUserId", "status");

-- CreateIndex
CREATE INDEX "ActionApproval_status_expiresAt_idx" ON "public"."ActionApproval"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "AuditEvent_ownerType_ownerId_occurredAt_idx" ON "public"."AuditEvent"("ownerType", "ownerId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditEvent_agentId_occurredAt_idx" ON "public"."AuditEvent"("agentId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditEvent_correlationId_idx" ON "public"."AuditEvent"("correlationId");

-- AddForeignKey
ALTER TABLE "public"."Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Membership" ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Invitation" ADD CONSTRAINT "Invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Invitation" ADD CONSTRAINT "Invitation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Agent" ADD CONSTRAINT "Agent_userOwnerId_fkey" FOREIGN KEY ("userOwnerId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Agent" ADD CONSTRAINT "Agent_organizationOwnerId_fkey" FOREIGN KEY ("organizationOwnerId") REFERENCES "public"."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AgentCapability" ADD CONSTRAINT "AgentCapability_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "public"."Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AgentFieldPolicy" ADD CONSTRAINT "AgentFieldPolicy_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "public"."Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PermissionGrant" ADD CONSTRAINT "PermissionGrant_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "public"."Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ActionApproval" ADD CONSTRAINT "ActionApproval_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "public"."Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ActionApproval" ADD CONSTRAINT "ActionApproval_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ActionApproval" ADD CONSTRAINT "ActionApproval_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "public"."PermissionGrant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ActionApproval" ADD CONSTRAINT "ActionApproval_requesterUserId_fkey" FOREIGN KEY ("requesterUserId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ActionApproval" ADD CONSTRAINT "ActionApproval_approverUserId_fkey" FOREIGN KEY ("approverUserId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuditEvent" ADD CONSTRAINT "AuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuditEvent" ADD CONSTRAINT "AuditEvent_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "public"."Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

