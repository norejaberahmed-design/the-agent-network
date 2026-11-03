"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AgentCreateForm() {
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
      const response = await fetch("/api/v1/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, purpose, primaryLanguage: "ar" }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(response.status === 401 ? "انتهت الجلسة. سجل الدخول مجدداً." : "تعذر إنشاء الوكيل. راجع البيانات وحاول مرة أخرى.");
        return;
      }
      setName("");
      setPurpose("");
      router.refresh();
    } catch {
      setError("تعذر الاتصال بالخادم. حاول مرة أخرى.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel" onSubmit={submit} style={{ display: "grid", gap: 14, marginBottom: 32 }}>
      <h2>إنشاء وكيل جديد</h2>
      <div className="field">
        <label htmlFor="agent-name">اسم الوكيل</label>
        <input id="agent-name" required minLength={2} maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="مثال: مساعدي المهني" />
      </div>
      <div className="field">
        <label htmlFor="agent-purpose">ما مهمة هذا الوكيل؟</label>
        <textarea id="agent-purpose" required minLength={10} maxLength={500} rows={3} value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="صف الغرض والنتيجة التي تريد من الوكيل مساعدتك في تحقيقها." />
      </div>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <div><button className="button" type="submit" disabled={busy}>{busy ? "جارٍ الإنشاء..." : "إنشاء كمسودة خاصة"}</button></div>
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>لا يتم نشر الوكيل أو منحه صلاحية التواصل عند إنشائه.</p>
    </form>
  );
}
