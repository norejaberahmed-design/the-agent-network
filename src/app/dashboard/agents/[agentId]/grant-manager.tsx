"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Grant = {
  id: string;
  purpose: string;
  actionScope: string[];
  targetScope: string[];
  dataScope: string[];
  expiresAt: string;
  maxUses: number | null;
  uses: number;
  version: number;
  status: string;
  createdAt: string;
  revokedAt: string | null;
};

export function GrantManager({
  agentId,
  canManage,
  initialGrants,
}: {
  agentId: string;
  canManage: boolean;
  initialGrants: Grant[];
}) {
  const router = useRouter();
  const [purpose, setPurpose] = useState("");
  const [action, setAction] = useState("DISCOVER_INTERNAL");
  const [target, setTarget] = useState("INTERNAL_REGISTRY");
  const [dataScope, setDataScope] = useState("PUBLIC_PROFILE");
  const [expiresAt, setExpiresAt] = useState(() => {
    const date = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const [maxUses, setMaxUses] = useState("100");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function createGrant(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/agents/${encodeURIComponent(agentId)}/grants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purpose,
          actionScope: [action],
          targetScope: [target],
          dataScope: [dataScope],
          expiresAt: new Date(expiresAt).toISOString(),
          maxUses: maxUses ? Number(maxUses) : undefined,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? "تعذر إنشاء التفويض.");
        return;
      }
      setPurpose("");
      router.refresh();
    } catch {
      setError("تعذر الاتصال بالخادم.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeGrant(grantId: string) {
    setError("");
    setBusy(true);
    try {
      const response = await fetch(
        `/api/v1/agents/${encodeURIComponent(agentId)}/grants/${encodeURIComponent(grantId)}/revoke`,
        { method: "POST" },
      );
      if (!response.ok) {
        setError("تعذر إلغاء التفويض. ربما تم إلغاؤه مسبقاً.");
        return;
      }
      router.refresh();
      window.location.reload();
    } catch {
      setError("تعذر الاتصال بالخادم.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ paddingBottom: 60 }}>
      <div className="panel" style={{ marginBottom: 22 }}>
        <h2>حدود التفويض</h2>
        <p className="muted">التفويض يحدد ما قد يسمح به المالك لاحقاً. لا توجد حالياً محركات تنفيذ خارجية؛ لذلك لا يستطيع أي تفويض هنا تشغيل عملية أو كشف بيانات.</p>
        {!canManage ? <p className="muted">لديك صلاحية العرض فقط.</p> : (
          <form onSubmit={createGrant} style={{ display: "grid", gap: 12 }}>
            <div className="field"><label htmlFor="grant-purpose">الغرض المحدد</label><input id="grant-purpose" required minLength={10} maxLength={300} value={purpose} onChange={(event) => setPurpose(event.target.value)} /></div>
            <div className="field">
              <label htmlFor="grant-action">نوع الصلاحية</label>
              <select id="grant-action" value={action} onChange={(event) => { setAction(event.target.value); setTarget(event.target.value === "DISCOVER_INTERNAL" ? "INTERNAL_REGISTRY" : "PUBLIC_WEB"); }}>
                <option value="DISCOVER_INTERNAL">اكتشاف داخل الشبكة</option>
                <option value="SEARCH_PUBLIC_WEB">البحث في الويب العام</option>
              </select>
            </div>
            <div className="field"><label htmlFor="grant-target">النطاق / الجهة المستهدفة</label><input id="grant-target" required minLength={3} maxLength={128} value={target} onChange={(event) => setTarget(event.target.value)} /></div>
            <div className="field">
              <label htmlFor="grant-data">نطاق البيانات</label>
              <select id="grant-data" value={dataScope} onChange={(event) => setDataScope(event.target.value)}>
                <option value="PUBLIC_PROFILE">الملف العام فقط</option>
                <option value="OWNER_APPROVED_CONTEXTUAL">بيانات سياقية يوافق عليها المالك</option>
              </select>
            </div>
            <div className="field"><label htmlFor="grant-expiry">انتهاء التفويض</label><input id="grant-expiry" type="datetime-local" required value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></div>
            <div className="field"><label htmlFor="grant-uses">الحد الأقصى للاستخدامات</label><input id="grant-uses" type="number" min={1} max={10000} value={maxUses} onChange={(event) => setMaxUses(event.target.value)} /></div>
            {error ? <p className="error" role="alert">{error}</p> : null}
            <div><button className="button" type="submit" disabled={busy}>{busy ? "جارٍ الحفظ..." : "إنشاء تفويض مقيد"}</button></div>
          </form>
        )}
      </div>
      <h2>سجل التفويضات ({initialGrants.length})</h2>
      <div className="list">
        {initialGrants.map((grant) => (
          <article className="panel" key={grant.id}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <strong>{grant.purpose}</strong><span className="pill">{grant.status === "ACTIVE" ? "مسجل — التنفيذ متوقف" : grant.status}</span>
            </div>
            <p className="muted" style={{ lineHeight: 1.8 }}>الصلاحيات: {grant.actionScope.join("، ")}<br />النطاق: {grant.targetScope.join("، ")}<br />البيانات: {grant.dataScope.join("، ")}<br />ينتهي: {new Date(grant.expiresAt).toLocaleString("en-GB")}<br />الاستخدام: {grant.uses}{grant.maxUses ? ` / ${grant.maxUses}` : ""} · الإصدار {grant.version}</p>
            {canManage && grant.status === "ACTIVE" ? <button className="button secondary" type="button" disabled={busy} onClick={() => revokeGrant(grant.id)}>إلغاء التفويض</button> : null}
          </article>
        ))}
        {initialGrants.length === 0 ? <div className="panel"><p className="muted">لا توجد تفويضات مسجلة لهذا الوكيل.</p></div> : null}
      </div>
      {error ? <p className="error" role="alert">{error}</p> : null}
    </section>
  );
}
