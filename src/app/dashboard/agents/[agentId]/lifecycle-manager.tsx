"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type AgentStatus = "DRAFT" | "ACTIVE" | "SUSPENDED";

const statusLabels: Record<AgentStatus, string> = {
  DRAFT: "مسودة",
  ACTIVE: "نشط",
  SUSPENDED: "موقوف",
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

  async function save() {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const response = await fetch(
        `/api/v1/agents/${encodeURIComponent(agentId)}/lifecycle`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status, discoverable }),
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
          onChange={(event) => {
            const next = event.target.value as AgentStatus;
            setStatus(next);
            if (next !== "ACTIVE") setDiscoverable(false);
          }}
        >
          <option value="DRAFT">مسودة</option>
          <option value="ACTIVE">نشط</option>
          <option value="SUSPENDED">موقوف</option>
        </select>
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <input
          type="checkbox"
          checked={discoverable}
          disabled={status !== "ACTIVE"}
          onChange={(event) => setDiscoverable(event.target.checked)}
        />
        السماح بظهور الوكيل في دليل الاكتشاف
      </label>
      {error ? <p className="error" role="alert">{error}</p> : null}
      {saved ? <p className="muted" role="status">تم حفظ حالة الوكيل.</p> : null}
      <div>
        <button
          className="button"
          type="button"
          onClick={() => void save()}
          disabled={busy || (status === initialStatus && discoverable === initialDiscoverable)}
        >
          {busy ? "جارٍ الحفظ..." : "حفظ الحالة"}
        </button>
      </div>
    </section>
  );
}
