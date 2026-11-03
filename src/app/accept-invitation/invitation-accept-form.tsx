"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export function InvitationAcceptForm({ token }: { token: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!token) {
      setError("رابط الدعوة غير مكتمل.");
      return;
    }
    setBusy(true);
    try {
      const result = await authClient.signUp.email(
        { name, email, password },
        {
          headers: {
            "x-invitation-token": token,
            "x-invitation-reservation-id": crypto.randomUUID(),
          },
        },
      );
      if (result.error) {
        setError("تعذر قبول الدعوة. قد تكون منتهية أو مستخدمة أو مخصصة لبريد آخر.");
        return;
      }
      router.replace("/dashboard");
    } catch {
      setError("تعذر إكمال التسجيل. حاول مرة أخرى أو اطلب دعوة جديدة.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <div>
        <div className="eyebrow">INVITATION ONLY</div>
        <h1 style={{ fontSize: 30 }}>إنشاء حساب بالدعوة</h1>
        <p className="muted">الدعوة شخصية، أحادية الاستخدام، وتنتهي صلاحيتها.</p>
      </div>
      <div className="field">
        <label htmlFor="name">الاسم</label>
        <input id="name" required minLength={2} maxLength={100} value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="email">البريد الإلكتروني</label>
        <input id="email" type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="password">كلمة المرور (12 حرفاً على الأقل)</label>
        <input id="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
      </div>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <button className="button" type="submit" disabled={busy || !token}>{busy ? "جارٍ إنشاء الحساب..." : "قبول الدعوة وإنشاء الحساب"}</button>
      <p className="muted" style={{ fontSize: 12 }}>بعد التسجيل، سجّل الدخول باستخدام البريد وكلمة المرور.</p>
    </form>
  );
}
