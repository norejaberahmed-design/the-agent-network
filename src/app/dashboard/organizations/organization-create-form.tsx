"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function OrganizationCreateForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const response = await fetch("/api/v1/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError("تعذر إنشاء مساحة الشركة. تحقق من البيانات وحاول مرة أخرى.");
        return;
      }
      setName("");
      router.refresh();
    } catch {
      setError("تعذر الاتصال بالخادم.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel" onSubmit={submit} style={{ display: "grid", gap: 12, marginBottom: 24 }}>
      <h2>إنشاء مساحة لشركة أو مؤسسة</h2>
      <div className="field">
        <label htmlFor="organization-name">اسم المؤسسة</label>
        <input id="organization-name" required minLength={2} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="اسم الشركة أو المؤسسة" />
      </div>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <div><button className="button" type="submit" disabled={busy}>{busy ? "جارٍ الإنشاء..." : "إنشاء مساحة المؤسسة"}</button></div>
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>ستكون مالك المؤسسة الأول، ويمكن إضافة الأعضاء بعد بناء إدارة العضويات.</p>
    </form>
  );
}
