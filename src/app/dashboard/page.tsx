import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AgentCreateForm } from "./agent-create-form";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const agents = await prisma.agent.findMany({
    where: { ownerType: "USER", userOwnerId: session.user.id },
    select: { id: true, name: true, purpose: true, status: true, discoverable: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <main className="shell">
      <header className="topbar">
        <Link className="brand" href="/"><span className="brand-mark">A</span>The Agent Network</Link>
        <span className="muted">{session.user.name || session.user.email}</span>
      </header>
      <section className="hero" style={{ paddingTop: 28 }}>
        <div className="eyebrow">OWNER WORKSPACE</div>
        <h1 style={{ fontSize: 38 }}>مساحة وكلائك</h1>
        <p className="lead">أنشئ وكلاءك وأدر إعداداتهم. يبدأ كل وكيل كمسودة وغير قابل للاكتشاف حتى تفعّل ذلك صراحةً.</p>
      </section>
      <AgentCreateForm />
      <section style={{ paddingBottom: 60 }}>
        <h2>الوكلاء ({agents.length})</h2>
        {agents.length === 0 ? (
          <div className="panel"><p>لم تنشئ أي وكيل بعد. ابدأ بإنشاء أول وكيل.</p></div>
        ) : (
          <div className="list">
            {agents.map((agent) => (
              <article className="agent-row" key={agent.id}>
                <div>
                  <strong>{agent.name}</strong>
                  <p className="muted" style={{ margin: "6px 0 0" }}>{agent.purpose}</p>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span className="pill">{agent.status === "DRAFT" ? "مسودة" : agent.status}</span>
                  <span className="muted" style={{ fontSize: 12 }}>{agent.discoverable ? "قابل للاكتشاف" : "خاص"}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
