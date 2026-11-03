import Link from "next/link";
import { InvitationAcceptForm } from "./invitation-accept-form";

export default async function AcceptInvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <main className="shell">
      <header className="topbar">
        <Link className="brand" href="/"><span className="brand-mark">A</span>The Agent Network</Link>
        <Link className="muted" href="/">الرئيسية</Link>
      </header>
      <InvitationAcceptForm token={token ?? ""} />
    </main>
  );
}
