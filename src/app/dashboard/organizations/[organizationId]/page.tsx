import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { OrganizationAgentCreateForm } from "./organization-agent-create-form";

export const dynamic = "force-dynamic";

export default async function OrganizationWorkspacePage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const { organizationId } = await params;
  const membership = await prisma.membership.findUnique({
    where: { organizationId_userId: { organizationId, userId: session.user.id } },
    select: { role: true, organization: { select: { id: true, name: true } } },
  });
  if (!membership) notFound();

  const agents = await prisma.agent.findMany({
    where: { ownerType: "ORGANIZATION", organizationOwnerId: organizationId },
    select: { id: true, name: true, purpose: true, status: true, discoverable: true },
    orderBy: { createdAt: "desc" },
  });

  const canManage = membership.role === "OWNER" || membership.role === "ADMIN" || membership.role === "AGENT_MANAGER";

  return (
    <main className="shell">
      <header className="topbar">
        <Link className="brand" href="/"><span className="brand-mark">A</span>The Agent Network</Link>
        <Link className="muted" href="/dashboard/organizations">المؤسسات</Link>
      </header>
      <section className="hero" style={{ paddingTop: 28 }}>
        <div className="eyebrow">ORGANIZATION AGENTS</div>
        <h1 style={{ fontSize: 36 }}>{membership.organization.name}</h1>
        <p className="lead">العضوية الحالية: {membership.role}. ملكية وكلاء هذه المساحة تعود للمؤسسة.</p>
      </section>
      {canManage ? <OrganizationAgentCreateForm organizationId={organizationId} /> : <div className="panel"><p>لديك صلاحية العرض فقط. اطلب من مالك المؤسسة منحك دوراً إدارياً لإضافة الوكلاء.</p></div>}
      <section style={{ paddingBottom: 60 }}>
        <h2>وكلاء المؤسسة ({agents.length})</h2>
        <div className="list">
          {agents.map((agent) => (
            <article className="agent-row" key={agent.id}>
              <div><strong>{agent.name}</strong><p className="muted" style={{ margin: "5px 0 0" }}>{agent.purpose}</p></div>
              <div style={{ display: "flex", gap: 8 }}><span className="pill">{agent.status}</span><span className="muted">{agent.discoverable ? "عام" : "خاص"}</span></div>
            </article>
          ))}
          {agents.length === 0 ? <div className="panel"><p>لم تنشئ المؤسسة أي وكيل بعد.</p></div> : null}
        </div>
      </section>
    </main>
  );
}
