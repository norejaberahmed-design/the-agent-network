"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export function SignInForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const result = await authClient.signIn.email({ email, password });
    setBusy(false);
    if (result.error) {
      setError("تعذر تسجيل الدخول. تحقق من البيانات أو تواصل مع مسؤول الدعوة.");
      return;
    }
    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <form className="form" onSubmit={submit}>
      <div>
        <div className="eyebrow">MEMBER ACCESS</div>
        <h1 style={{ fontSize: 30 }}>تسجيل الدخول</h1>
        <p className="muted">الوصول متاح للأعضاء الذين حصلوا على دعوة.</p>
      </div>
      <div className="field">
        <label htmlFor="email">البريد الإلكتروني</label>
        <input id="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="password">كلمة المرور</label>
        <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
      </div>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <button className="button" type="submit" disabled={busy}>{busy ? "جارٍ الدخول..." : "دخول آمن"}</button>
      <p className="muted" style={{ fontSize: 12 }}>لا يوجد تسجيل عام في هذه المرحلة.</p>
    </form>
  );
}
