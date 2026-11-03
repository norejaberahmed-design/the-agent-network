import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAgentAccess } from "@/modules/agents/access";
import { GrantManager } from "./grant-manager";
import { FieldPolicyManager } from "./field-policy-manager";
import { AgentLifecycleManager } from "./lifecycle-manager";
import { ActionApprovalManager } from "./action-approval-manager";
import { RunManager } from "./run-manager";

export const dynamic = "force-dynamic";

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const { agentId } = await params;
  const access = await getAgentAccess(agentId, session.user.id);
  if (!access) notFound();

  const fieldPolicies = await prisma.agentFieldPolicy.findMany({
    where: { agentId },
    select: {
      id: true,
      fieldKey: true,
      classification: true,
      publicVisible: true,
      allowedPurposes: true,
      allowedAudiences: true,
      retentionDays: true,
      policyVersion: true,
      updatedAt: true,
    },
    orderBy: { fieldKey: "asc" },
  });

  const grants = await prisma.permissionGrant.findMany({
    where: { agentId },
    select: {
      id: true,
      purpose: true,
      actionScope: true,
      targetScope: true,
      dataScope: true,
      expiresAt: true,
      maxUses: true,
      uses: true,
      reservedUses: true,
      version: true,
      status: true,
      createdAt: true,
      revokedAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const runs = access.canView ? await prisma.agentRun.findMany({
    where: { agentId },
    select: {
      id: true,
      task: true,
      purpose: true,
      target: true,
      authorizedActions: true,
      status: true,
      attemptCount: true,
      maxAttempts: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  }) : [];

  const grantOptions = grants
    .filter((grant) =>
      grant.status === "ACTIVE" &&
      grant.expiresAt > new Date() &&
      (grant.maxUses === null || grant.uses + grant.reservedUses < grant.maxUses) &&
      grant.dataScope.includes("PUBLIC_PROFILE")
    )
    .flatMap((grant) => grant.targetScope.map((target) => ({
      purpose: grant.purpose,
      target,
      actionScope: grant.actionScope,
      dataScope: grant.dataScope,
    })))
    .filter((option, index, all) => all.findIndex((candidate) =>
      candidate.purpose === option.purpose && candidate.target === option.target
    ) === index);

  return (
    <main className="shell">
      <header className="topbar">
        <Link className="brand" href="/"><span className="brand-mark">A</span>The Agent Network</Link>
        <Link className="muted" href={access.ownerType === "USER" ? "/dashboard" : "/dashboard/organizations"}>العودة</Link>
      </header>
      <section className="hero" style={{ paddingTop: 28 }}>
        <div className="eyebrow">AGENT GOVERNANCE</div>
        <h1 style={{ fontSize: 36 }}>{access.agent.name}</h1>
        {access.canViewPrivate ? <p className="lead">{access.agent.purpose}</p> : <p className="lead">لديك صلاحية عرض معلومات الوكيل الأساسية فقط.</p>}
        <div className="actions">
          <span className="pill">{access.agent.status}</span>
          <span className="muted">{access.ownerType === "USER" ? "وكيل شخصي" : "وكيل مؤسسة"}</span>
          <span className="muted">الإصدار {access.agent.configurationVersion}</span>
        </div>
      </section>
      <AgentLifecycleManager
        agentId={agentId}
        initialStatus={access.agent.status}
        initialDiscoverable={access.agent.discoverable}
        canManage={access.canManageFieldPolicies}
      />
      {access.canViewFieldPolicies ? (
        <FieldPolicyManager
          agentId={agentId}
          canManage={access.canManageFieldPolicies}
          initialPolicies={fieldPolicies.map((policy) => ({
            ...policy,
            updatedAt: policy.updatedAt.toISOString(),
          }))}
        />
      ) : null}
      {access.canManagePermissions ? (
        <RunManager
          agentId={agentId}
          active={access.agent.status === "ACTIVE"}
          initialRuns={runs.map((run) => ({ ...run, createdAt: run.createdAt.toISOString() }))}
          grantOptions={grantOptions}
        />
      ) : null}
      {access.canViewGrants ? (
        <>
          <GrantManager
            agentId={agentId}
            canManage={access.canManagePermissions}
            initialGrants={grants.map((grant) => ({
              ...grant,
              expiresAt: grant.expiresAt.toISOString(),
              createdAt: grant.createdAt.toISOString(),
              revokedAt: grant.revokedAt?.toISOString() ?? null,
            }))}
          />
          {access.ownerType === "ORGANIZATION" && access.canManagePermissions ? <ActionApprovalManager
            agentId={agentId}
            currentUserId={session.user.id}
            canRequest={access.canManagePermissions}
            canApprove={access.canManageFieldPolicies}
            grants={grants
              .filter((grant) =>
                grant.status === "ACTIVE" &&
                grant.revokedAt === null &&
                grant.expiresAt > new Date() &&
                (grant.maxUses === null || grant.uses < grant.maxUses),
              )
              .map((grant) => ({
                id: grant.id,
                actionScope: grant.actionScope,
                targetScope: grant.targetScope,
                dataScope: grant.dataScope,
                status: grant.status,
                expiresAt: grant.expiresAt.toISOString(),
              }))}
          /> : null}
        </>
      ) : null}
    </main>
  );
}
