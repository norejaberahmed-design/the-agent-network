import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuditLogList } from "./audit-log-list";

export const dynamic = "force-dynamic";

export default async function OrganizationAuditPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const { organizationId } = await params;
  const membership = await prisma.membership.findUnique({
    where: {
      organizationId_userId: {
        organizationId,
        userId: session.user.id,
      },
    },
    select: {
      role: true,
      organization: { select: { name: true } },
    },
  });

  if (
    !membership ||
    (membership.role !== "OWNER" &&
      membership.role !== "ADMIN" &&
      membership.role !== "AUDITOR")
  ) {
    notFound();
  }

  return (
    <main className="shell">
      <header className="topbar">
        <Link className="brand" href="/"><span className="brand-mark">A</span>The Agent Network</Link>
        <Link className="muted" href={`/dashboard/organizations/${organizationId}`}>العودة للمؤسسة</Link>
      </header>
      <section className="hero" style={{ paddingTop: 28 }}>
        <div className="eyebrow">ORGANIZATION AUDIT</div>
        <h1 style={{ fontSize: 36 }}>سجل التدقيق</h1>
        <p className="lead">{membership.organization.name} · سجل زمني للتغييرات الإدارية والأمنية.</p>
      </section>
      <AuditLogList organizationId={organizationId} />
    </main>
  );
}
