"use client";

import { useState } from "react";

type CreatedInvitation = {
  redemptionUrl: string;
  expiresAt: string;
};

export function InvitationCreateForm() {
  const [email, setEmail] = useState("");
  const [hours, setHours] = useState(72);
  const [created, setCreated] = useState<CreatedInvitation | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setCreated(null);
    setBusy(true);
    try {
      const response = await fetch("/api/admin/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() || undefined, expiresInHours: hours }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(response.status === 403 ? "لا تملك صلاحية إنشاء الدعوات." : "تعذر إنشاء الدعوة.");
        return;
      }
      setCreated(body.data);
      setEmail("");
    } catch {
      setError("تعذر الاتصال بالخادم.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel" onSubmit={submit} style={{ display: "grid", gap: 14, marginBottom: 28 }}>
      <h2>دعوة عضو جديد</h2>
      <div className="field">
        <label htmlFor="invite-email">البريد المستهدف (اختياري)</label>
        <input id="invite-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" />
      </div>
      <div className="field">
        <label htmlFor="invite-hours">مدة الصلاحية بالساعات (1–168)</label>
        <input id="invite-hours" type="number" min={1} max={168} value={hours} onChange={(event) => setHours(Number(event.target.value))} />
      </div>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <div><button className="button" type="submit" disabled={busy}>{busy ? "جارٍ الإنشاء..." : "إنشاء دعوة"}</button></div>
      {created ? (
        <div className="panel">
          <strong>تم إنشاء رابط الدعوة — انسخه واحفظه الآن</strong>
          <input readOnly value={created.redemptionUrl} aria-label="رابط الدعوة" />
          <button className="button secondary" type="button" onClick={() => navigator.clipboard.writeText(created.redemptionUrl)}>نسخ الرابط</button>
          <p className="muted" style={{ fontSize: 12 }}>تنتهي صلاحية الدعوة: {new Date(created.expiresAt).toLocaleString("en-GB")}. لن يظهر الرابط مرة أخرى.</p>
        </div>
      ) : null}
    </form>
  );
}
