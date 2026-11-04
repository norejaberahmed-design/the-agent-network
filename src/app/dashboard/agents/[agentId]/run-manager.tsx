"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type GrantOption = {
  purpose: string;
  target: string;
  actionScope: string[];
  dataScope: string[];
};
const statusLabels: Record<string, string> = {
  QUEUED: "بانتظار العامل",
  CLAIMED: "حُجزت للعامل",
  PLANNING: "جارٍ التخطيط",
  WAITING_APPROVAL: "بانتظار موافقتك",
  COMPLETED: "مكتملة",
  FAILED: "فشلت",
  CANCELLED: "أُلغيت",
  DEAD_LETTER: "توقفت بعد استنفاد المحاولات",
};

type Run = {
  id: string;
  task: string;
  purpose: string;
  target: string;
  authorizedActions: string[];
  status: string;
  attemptCount: number;
  maxAttempts: number;
  createdAt: string;
};

export function RunManager({
  agentId,
  active,
  initialRuns,
  grantOptions,
}: {
  agentId: string;
  active: boolean;
  initialRuns: Run[];
  grantOptions: GrantOption[];
}) {
  const router = useRouter();
  const [task, setTask] = useState("");
  const [selected, setSelected] = useState(0);
  const [runs, setRuns] = useState(initialRuns);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => setRuns(initialRuns), [initialRuns]);

  async function queueRun(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active || grantOptions.length === 0) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const grant = grantOptions[selected] ?? grantOptions[0];
      if (!grant) return;
      const response = await fetch(`/api/v1/agents/${encodeURIComponent(agentId)}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task,
          purpose: grant.purpose,
          target: grant.target,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? "تعذر إضافة المهمة إلى قائمة الانتظار.");
        return;
      }
      setTask("");
      setRuns((current) => [body.data as Run, ...current].slice(0, 50));
      setNotice("تم حفظ المهمة في قائمة الانتظار. لم يبدأ التنفيذ بعد.");
      router.refresh();
    } catch {
      setError("تعذر الاتصال بالخادم.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelRun(runId: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}/cancel`,
        { method: "POST" },
      );
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? "تعذر إلغاء المهمة.");
        return;
      }
      setRuns((current) => current.map((run) =>
        run.id === runId ? { ...run, status: "CANCELLED" } : run
      ));
      setNotice("أُلغيت المهمة وأُعيد رصيد التفويض المحجوز.");
      router.refresh();
    } catch {
      setError("تعذر الاتصال بالخادم.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" style={{ margin: "28px 0" }}>
      <div className="eyebrow">AGENT RUNTIME</div>
      <h2>إدارة المهام</h2>
      <p className="muted">تُحفظ المهمة في قاعدة البيانات بعد التحقق من صلاحيات الوكيل والتفويض النشط. قائمة الانتظار لا تنفّذ المهام حالياً.</p>
      {!active ? <p className="muted">فعّل الوكيل أولاً لإضافة مهام.</p> : grantOptions.length === 0 ? (
        <p className="muted">لا يوجد تفويض نشط يطابق غرضاً ونطاقاً مسموحاً. أنشئ تفويضاً محدوداً أولاً.</p>
      ) : (
        <form onSubmit={queueRun} style={{ display: "grid", gap: 12 }}>
          <div className="field">
            <label htmlFor="run-grant">التفويض المستخدم</label>
            <select id="run-grant" value={selected} onChange={(event) => setSelected(Number(event.target.value))}>
              {grantOptions.map((grant, index) => (
                <option key={`${grant.purpose}:${grant.target}:${index}`} value={index}>
                  {`${grant.purpose} — ${grant.target}`}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="run-task">المهمة المطلوبة</label>
            <textarea id="run-task" required minLength={1} maxLength={4000} rows={4} value={task} onChange={(event) => setTask(event.target.value)} />
          </div>
          <div><button className="button" type="submit" disabled={busy || !task.trim()}>{busy ? "جارٍ الحفظ..." : "إضافة إلى قائمة الانتظار"}</button></div>
        </form>
      )}
      {error ? <p className="error" role="alert">{error}</p> : null}
      {notice ? <p className="muted" role="status">{notice}</p> : null}
      <h3 style={{ marginTop: 28 }}>المهام المحفوظة ({runs.length})</h3>
      <div className="list">
        {runs.map((run) => (
          <article className="panel" key={run.id}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <strong>{statusLabels[run.status] ?? run.status}</strong><span className="muted">{new Date(run.createdAt).toLocaleString("ar-SA")}</span>
            </div>
            <p>{run.task}</p>
            <p className="muted">النطاق: {run.target} · الصلاحيات: {run.authorizedActions.join("، ")} · المحاولة {run.attemptCount}/{run.maxAttempts}</p>
            {run.status === "QUEUED" || run.status === "CLAIMED" ? (
              <button className="button secondary" type="button" disabled={busy} onClick={() => cancelRun(run.id)}>إلغاء المهمة</button>
            ) : null}
          </article>
        ))}
        {runs.length === 0 ? <p className="muted">لا توجد مهام محفوظة حتى الآن.</p> : null}
      </div>
    </section>
  );
}
