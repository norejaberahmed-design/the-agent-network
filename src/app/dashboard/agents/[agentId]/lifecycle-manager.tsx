"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type AgentStatus = "DRAFT" | "ACTIVE" | "PAUSED" | "SUSPENDED" | "REVOKED";

const statusLabels: Record<AgentStatus, string> = {
  DRAFT: "مسودة",
  ACTIVE: "نشط",
  PAUSED: "متوقف مؤقتاً",
  SUSPENDED: "موقوف",
  REVOKED: "ملغى نهائياً",
};

export function AgentLifecycleManager({
  agentId,
  initialStatus,
  initialDiscoverable,
  canManage,
}: {
  agentId: string;
  initialStatus: AgentStatus;
  initialDiscoverable: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<AgentStatus>(initialStatus);
  const [discoverable, setDiscoverable] = useState(initialDiscoverable);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function save(nextStatus: AgentStatus = status, nextDiscoverable = discoverable) {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const response = await fetch(
        `/api/v1/agents/${encodeURIComponent(agentId)}/lifecycle`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: nextStatus, discoverable: nextDiscoverable }),
        },
      );
      const body = await response.json();
      if (!response.ok) {
        setError(response.status === 422
          ? "لا يمكن إتاحة الوكيل قبل السماح بحقل عام واحد على الأقل في سياسة الإفصاح."
          : "تعذر تحديث حالة الوكيل.");
        return;
      }
      setStatus(body.data.status);
      setDiscoverable(body.data.discoverable);
      setSaved(true);
      router.refresh();
    } catch {
      setError("تعذر الاتصال بالخادم.");
    } finally {
      setBusy(false);
    }
  }

  if (!canManage) {
    return (
      <section className="panel" style={{ marginBottom: 22 }}>
        <h2>حالة الوكيل</h2>
        <p className="muted">
          {statusLabels[initialStatus]} · {initialDiscoverable ? "قابل للاكتشاف" : "غير متاح للاكتشاف"}
        </p>
      </section>
    );
  }

  return (
    <section className="panel" style={{ marginBottom: 22, display: "grid", gap: 12 }}>
      <div>
        <h2>حالة الوكيل وإتاحته</h2>
        <p className="muted" style={{ margin: "6px 0 0" }}>
          يبدأ الوكيل كمسودة خاصة. لا يمكن إتاحته للاكتشاف إلا بعد تفعيل الوكيل والسماح بحقل عام واحد على الأقل.
        </p>
      </div>
      <div className="field">
        <label htmlFor="agent-status">حالة الوكيل</label>
        <select
          id="agent-status"
          value={status}
          disabled={initialStatus === "REVOKED"}
          onChange={(event) => {
            const next = event.target.value as AgentStatus;
            setStatus(next);
            if (next !== "ACTIVE") setDiscoverable(false);
          }}
        >
          <option value="DRAFT">مسودة</option>
          <option value="ACTIVE">نشط</option>
          <option value="PAUSED">متوقف مؤقتاً</option>
          <option value="SUSPENDED">موقوف</option>
          {status === "REVOKED" ? <option value="REVOKED" disabled>ملغى نهائياً</option> : null}
        </select>
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <input
          type="checkbox"
          checked={discoverable}
          disabled={status !== "ACTIVE" || initialStatus === "REVOKED"}
          onChange={(event) => setDiscoverable(event.target.checked)}
        />
        السماح بظهور الوكيل في دليل الاكتشاف
      </label>
      {error ? <p className="error" role="alert">{error}</p> : null}
      {saved ? <p className="muted" role="status">تم حفظ حالة الوكيل.</p> : null}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          className="button"
          type="button"
          onClick={() => void save()}
          disabled={busy || initialStatus === "REVOKED" || (status === initialStatus && discoverable === initialDiscoverable)}
        >
          {busy ? "جارٍ الحفظ..." : "حفظ الحالة"}
        </button>
        <button
          className="button button-danger"
          type="button"
          onClick={() => {
            if (window.confirm("إلغاء هذا الوكيل نهائياً؟ سيُوقف ظهوره وتُلغى مهامه المعلّقة، ولا يمكن إعادة تفعيله.")) {
              void save("REVOKED", false);
            }
          }}
          disabled={busy || initialStatus === "REVOKED"}
        >
          إلغاء الوكيل نهائياً
        </button>
      </div>
    </section>
  );
}
