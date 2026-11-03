import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { InvitationCreateForm } from "./invitation-create-form";

export const dynamic = "force-dynamic";

export default async function InvitationsAdminPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const actor = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { platformRole: true },
  });
  if (actor?.platformRole !== "PLATFORM_ADMIN") redirect("/dashboard");

  const [invitations, organizations] = await Promise.all([
    prisma.invitation.findMany({
      select: {
        id: true,
        intendedEmail: true,
        status: true,
        role: true,
        expiresAt: true,
        createdAt: true,
        organization: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    prisma.organization.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <main className="shell">
      <header className="topbar">
        <Link className="brand" href="/"><span className="brand-mark">A</span>The Agent Network</Link>
        <Link className="muted" href="/dashboard">مساحة العمل</Link>
      </header>
      <section className="hero" style={{ paddingTop: 28 }}>
        <div className="eyebrow">PLATFORM ADMINISTRATION</div>
        <h1 style={{ fontSize: 36 }}>إدارة الدعوات</h1>
        <p className="lead">إنشاء دعوات عالمية محددة البريد أو عامة، مع صلاحية محدودة واستخدام واحد.</p>
      </section>
      <InvitationCreateForm organizations={organizations} />
      <section style={{ paddingBottom: 60 }}>
        <h2>آخر الدعوات</h2>
        <div className="list">
          {invitations.map((invite) => (
            <article className="agent-row" key={invite.id}>
              <div>
                <strong>{invite.intendedEmail ?? "دعوة عامة"}</strong>
                <p className="muted" style={{ margin: "5px 0 0", fontSize: 12 }}>
                  {invite.organization ? `${invite.organization.name} · ${invite.role}` : "دعوة عامة للمنصة"}
                  {" · "}تنتهي: {invite.expiresAt.toLocaleString("en-GB")}
                </p>
              </div>
              <span className="pill">{invite.status}</span>
            </article>
          ))}
          {invitations.length === 0 ? <div className="panel"><p>لا توجد دعوات بعد.</p></div> : null}
        </div>
      </section>
    </main>
  );
}
