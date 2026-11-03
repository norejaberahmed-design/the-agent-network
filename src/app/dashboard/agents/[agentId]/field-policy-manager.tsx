"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Policy = {
  id: string;
  fieldKey: string;
  classification: "PUBLIC" | "CONTEXTUAL" | "PRIVATE" | "HIGHLY_SENSITIVE";
  publicVisible: boolean;
  allowedPurposes: string[];
  allowedAudiences: string[];
  retentionDays: number | null;
  policyVersion: number;
  updatedAt: string;
};

const fields = [
  { key: "name", label: "اسم الوكيل" },
  { key: "publicDescription", label: "الوصف العام" },
  { key: "purpose", label: "الغرض الداخلي" },
] as const;

export function FieldPolicyManager({
  agentId,
  canManage,
  initialPolicies,
}: {
  agentId: string;
  canManage: boolean;
  initialPolicies: Policy[];
}) {
  const router = useRouter();
  const [policies, setPolicies] = useState(initialPolicies);
  const [fieldKey, setFieldKey] = useState<string>("name");
  const selected = useMemo(
    () => policies.find((policy) => policy.fieldKey === fieldKey),
    [policies, fieldKey],
  );
  const [classification, setClassification] = useState<Policy["classification"]>("PUBLIC");
  const [publicVisible, setPublicVisible] = useState(false);
  const [purposes, setPurposes] = useState("");
  const [audiences, setAudiences] = useState("");
  const [retentionDays, setRetentionDays] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setClassification(selected?.classification ?? (fieldKey === "purpose" ? "PRIVATE" : "PUBLIC"));
    setPublicVisible(selected?.publicVisible ?? false);
    setPurposes(selected?.allowedPurposes.join(", ") ?? "");
    setAudiences(selected?.allowedAudiences.join(", ") ?? "");
    setRetentionDays(selected?.retentionDays ? String(selected.retentionDays) : "");
  }, [selected, fieldKey]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/agents/${encodeURIComponent(agentId)}/field-policies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fieldKey,
          classification,
          publicVisible,
          allowedPurposes: purposes.split(",").map((value) => value.trim()).filter(Boolean),
          allowedAudiences: audiences.split(",").map((value) => value.trim()).filter(Boolean),
          retentionDays: retentionDays ? Number(retentionDays) : null,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? "تعذر حفظ سياسة الخصوصية.");
        return;
      }
      setPolicies((current) => [
        ...current.filter((policy) => policy.fieldKey !== body.data.fieldKey),
        { ...body.data, updatedAt: body.data.updatedAt },
      ]);
      router.refresh();
    } catch {
      setError("تعذر الاتصال بالخادم.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" style={{ marginBottom: 22 }}>
      <h2>خصوصية الحقول والإفصاح</h2>
      <p className="muted">حدد تصنيف كل حقل والجمهور والغرض المسموح. لا يسمح النظام بإظهار حقل خاص أو سياقي أو شديد الحساسية للعامة.</p>
      <div className="field">
        <label htmlFor="policy-field">الحقل</label>
        <select id="policy-field" value={fieldKey} onChange={(event) => setFieldKey(event.target.value)}>
          {fields.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
        </select>
      </div>
      {canManage ? (
        <form onSubmit={save} style={{ display: "grid", gap: 12, marginTop: 14 }}>
          <div className="field">
            <label htmlFor="policy-classification">تصنيف البيانات</label>
            <select
              id="policy-classification"
              value={classification}
              onChange={(event) => {
                const next = event.target.value as Policy["classification"];
                setClassification(next);
                if (next !== "PUBLIC") setPublicVisible(false);
              }}
            >
              <option value="PUBLIC">عام</option>
              <option value="CONTEXTUAL">سياقي</option>
              <option value="PRIVATE">خاص</option>
              <option value="HIGHLY_SENSITIVE">شديد الحساسية</option>
            </select>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <input
              type="checkbox"
              checked={publicVisible}
              disabled={classification !== "PUBLIC"}
              onChange={(event) => setPublicVisible(event.target.checked)}
            />
            إظهار هذا الحقل للعامة
          </label>
          <div className="field"><label htmlFor="policy-purposes">الأغراض المسموحة (افصل بينها بفاصلة)</label><input id="policy-purposes" value={purposes} onChange={(event) => setPurposes(event.target.value)} placeholder="agent-discovery, profile-view" /></div>
          <div className="field"><label htmlFor="policy-audiences">الجمهور المسموح (افصل بينهم بفاصلة)</label><input id="policy-audiences" value={audiences} onChange={(event) => setAudiences(event.target.value)} placeholder="network-agents, verified-organizations" /></div>
          <div className="field"><label htmlFor="policy-retention">مدة الاحتفاظ بالأيام (اختياري)</label><input id="policy-retention" type="number" min={1} max={3650} value={retentionDays} onChange={(event) => setRetentionDays(event.target.value)} /></div>
          {error ? <p className="error" role="alert">{error}</p> : null}
          <div><button className="button" type="submit" disabled={busy || (publicVisible && classification !== "PUBLIC")}>{busy ? "جارٍ الحفظ..." : "حفظ سياسة الحقل"}</button></div>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>الإصدار الحالي: {selected?.policyVersion ?? 0}. كل تغيير ينشئ إصداراً جديداً ويسجل في سجل التدقيق.</p>
        </form>
      ) : (
        <p className="muted">تصنيف الحقل: {selected?.classification ?? "غير محدد"}. صلاحية العرض فقط.</p>
      )}
    </section>
  );
}
