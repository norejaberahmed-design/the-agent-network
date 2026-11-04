import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ProfileForm } from "./profile-form";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { name: true, email: true, createdAt: true },
  });
  if (!user) redirect("/sign-in");

  return (
    <main className="shell">
      <header className="topbar">
        <Link className="brand" href="/"><span className="brand-mark">A</span>The Agent Network</Link>
        <Link className="muted" href="/dashboard">العودة إلى مساحة العمل</Link>
      </header>
      <section className="hero" style={{ paddingTop: 28 }}>
        <div className="eyebrow">ACCOUNT SETTINGS</div>
        <h1 style={{ fontSize: 36 }}>الملف الشخصي</h1>
        <p className="lead">تحكم في اسم العرض المرتبط بحسابك. البريد الإلكتروني ودور المنصة لا يمكن تغييرهما من هذه الشاشة.</p>
      </section>
      <ProfileForm initialName={user.name} email={user.email} createdAt={user.createdAt.toISOString()} />
    </main>
  );
}
