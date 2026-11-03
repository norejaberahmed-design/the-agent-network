import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { OrganizationCreateForm } from "./organization-create-form";

export const dynamic = "force-dynamic";

export default async function OrganizationsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const memberships = await prisma.membership.findMany({
    where: { userId: session.user.id },
    select: {
      role: true,
      organization: {
        select: { id: true, name: true, slug: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <main className="shell">
      <header className="topbar">
        <Link className="brand" href="/"><span className="brand-mark">A</span>The Agent Network</Link>
        <Link className="muted" href="/dashboard">مساحة وكلائي</Link>
      </header>
      <section className="hero" style={{ paddingTop: 28 }}>
        <div className="eyebrow">ORGANIZATION WORKSPACES</div>
        <h1 style={{ fontSize: 36 }}>مساحات المؤسسات</h1>
        <p className="lead">أنشئ مساحة مستقلة للمؤسسة، وامتلك وكلاءها بصفتها كياناً مستقلاً عن حسابك الشخصي.</p>
      </section>
      <OrganizationCreateForm />
      <section style={{ paddingBottom: 60 }}>
        <h2>المؤسسات ({memberships.length})</h2>
        <div className="list">
          {memberships.map(({ organization, role }) => (
            <article className="agent-row" key={organization.id}>
              <div><Link href={`/dashboard/organizations/${organization.id}`}><strong>{organization.name}</strong></Link><p className="muted" style={{ margin: "5px 0 0", fontSize: 12 }}>{organization.slug}</p></div>
              <span className="pill">{role}</span>
            </article>
          ))}
          {memberships.length === 0 ? <div className="panel"><p>لا توجد مساحات مؤسسات مرتبطة بحسابك.</p></div> : null}
        </div>
      </section>
    </main>
  );
}
