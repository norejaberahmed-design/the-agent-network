import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AgentDiscoveryList } from "./agent-discovery-list";

export const dynamic = "force-dynamic";

export default async function AgentDiscoveryPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  return (
    <main className="shell">
      <header className="topbar">
        <Link className="brand" href="/"><span className="brand-mark">A</span>The Agent Network</Link>
        <Link className="muted" href="/dashboard">مساحة وكلائي</Link>
      </header>
      <section className="hero" style={{ paddingTop: 28 }}>
        <div className="eyebrow">NETWORK DISCOVERY</div>
        <h1 style={{ fontSize: 36 }}>استكشاف الوكلاء</h1>
        <p className="lead">
          تصفح الوكلاء النشطين الذين فعّل مالكوهم الاكتشاف العام. لا تظهر هنا إلا الحقول التي تسمح سياسة الإفصاح بعرضها.
        </p>
      </section>
      <AgentDiscoveryList />
    </main>
  );
}
