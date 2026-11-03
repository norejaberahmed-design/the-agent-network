"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { InvitationAcceptForm } from "./invitation-accept-form";

export default function AcceptInvitationPage() {
  const [token, setToken] = useState("");

  useEffect(() => {
    const fragment = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : "";
    const params = new URLSearchParams(fragment);
    setToken(params.get("token") ?? "");
    if (fragment) {
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}`,
      );
    }
  }, []);

  return (
    <main className="shell">
      <header className="topbar">
        <Link className="brand" href="/"><span className="brand-mark">A</span>The Agent Network</Link>
        <Link className="muted" href="/">الرئيسية</Link>
      </header>
      <InvitationAcceptForm token={token} />
    </main>
  );
}
