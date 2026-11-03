"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function OrganizationAgentCreateForm({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/organizations/${encodeURIComponent(organizationId)}/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, purpose, primaryLanguage: "ar" }),
      });
      if (!response.ok) {
        setError(response.status === 403 ? "ليس لديك صلاحية إدارة وكلاء هذه المؤسسة." : "تعذر إنشاء الوكيل.");
        return;
      }
      setName("");
      setPurpose("");
      router.refresh();
    } catch {
      setError("تعذر الاتصال بالخادم.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel" onSubmit={submit} style={{ display: "grid", gap: 12, marginBottom: 28 }}>
      <h2>إنشاء وكيل للمؤسسة</h2>
      <div className="field"><label htmlFor="org-agent-name">اسم الوكيل</label><input id="org-agent-name" required minLength={2} maxLength={80} value={name} onChange={(event) => setName(event.target.value)} /></div>
      <div className="field"><label htmlFor="org-agent-purpose">الغرض من الوكيل</label><textarea id="org-agent-purpose" required minLength={10} maxLength={500} rows={3} value={purpose} onChange={(event) => setPurpose(event.target.value)} /></div>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <div><button className="button" type="submit" disabled={busy}>{busy ? "جارٍ الإنشاء..." : "إنشاء كمسودة خاصة"}</button></div>
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>الوكيل مملوك للمؤسسة وليس لحساب الموظف الذي أنشأه.</p>
    </form>
  );
}
