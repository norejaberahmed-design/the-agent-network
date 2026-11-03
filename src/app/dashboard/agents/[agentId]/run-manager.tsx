"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type GrantOption = {
  purpose: string;
  target: string;
  actionScope: string[];
  dataScope: string[];
};
type Run = {
  id: string;
  task: string;
  purpose: string;
  target: string;
  authorizedActions: string[];
  status: string;
  errorCode?: string | null;
  attemptCount: number;
  maxAttempts: number;
  createdAt: string;
  planSummary?: string | null;
  planSources?: Array<{ url: string; title: string }> | null;
  steps?: Array<{ stepId: string; ordinal: number; action: string; description: string; input: unknown; status: string }>;
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
  const [providerConsent, setProviderConsent] = useState(false);
  const [selected, setSelected] = useState(0);
  const [runs, setRuns] = useState(initialRuns);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function queueRun(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active || grantOptions.length === 0 || !providerConsent) return;
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
          providerConsent: true,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? "تعذر إضافة المهمة إلى قائمة الانتظار.");
        return;
      }
      setTask("");
      setProviderConsent(false);
      setRuns((current) => [body.data as Run, ...current].slice(0, 50));
      setNotice("تم حفظ المهمة في قائمة الانتظار. سيُنشئ العامل خطة للمراجعة فقط.");
      router.refresh();
    } catch {
      setError("تعذر الاتصال بالخادم.");
    } finally {
      setBusy(false);
    }
  }

  async function rejectPlan(runId: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}/reject`,
        { method: "POST" },
      );
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? "تعذر رفض الخطة.");
        return;
      }
      setRuns((current) => current.map((run) => run.id === runId ? { ...run, status: "CANCELLED" } : run));
      setNotice("تم رفض الخطة. لم يُنفّذ أي إجراء خارجي.");
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
      <p className="muted">يُحفظ نص المهمة في قاعدة البيانات ويُرسل إلى مزود الذكاء الاصطناعي عند تشغيل العامل. لا تُدخل كلمات مرور أو بيانات شخصية أو أسراراً. لا ينفّذ النظام أي إجراء خارجي من هذه الشاشة.</p>
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
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <input type="checkbox" checked={providerConsent} onChange={(event) => setProviderConsent(event.target.checked)} />
            <span>أوافق على إرسال نص المهمة إلى مزود الذكاء الاصطناعي المكوّن، واستخدام البحث العام فقط إذا سمح التفويض بذلك.</span>
          </label>
          <div><button className="button" type="submit" disabled={busy || !task.trim() || !providerConsent}>{busy ? "جارٍ الحفظ..." : "إضافة إلى قائمة الانتظار"}</button></div>
        </form>
      )}
      {error ? <p className="error" role="alert">{error}</p> : null}
      {notice ? <p className="muted" role="status">{notice}</p> : null}
      <h3 style={{ marginTop: 28 }}>المهام المحفوظة ({runs.length})</h3>
      <div className="list">
        {runs.map((run) => (
          <article className="panel" key={run.id}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <strong>{run.status}</strong><span className="muted">{new Date(run.createdAt).toLocaleString("ar-SA")}</span>
            </div>
            <p>{run.task}</p>
            <p className="muted">النطاق: {run.target} · الصلاحيات: {run.authorizedActions.join("، ")}</p>
            {run.errorCode ? <p className="error">رمز الحالة: {run.errorCode}</p> : null}
            {run.planSummary ? (
              <div className="panel" style={{ marginTop: 12 }}>
                <strong>خطة مقترحة للمراجعة — غير منفّذة</strong>
                <p>{run.planSummary}</p>
                {run.steps?.map((step) => (
                  <div key={step.stepId} style={{ marginTop: 10 }}>
                    <strong>{step.ordinal + 1}. {step.action}</strong>
                    <p>{step.description}</p>
                  </div>
                ))}
                {run.planSources?.length ? (
                  <div style={{ marginTop: 12 }}>
                    <strong>المصادر التي أعادها البحث</strong>
                    <ul>{run.planSources.map((source) => (
                      <li key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a></li>
                    ))}</ul>
                  </div>
                ) : null}
              </div>
            ) : null}
            {run.status === "PLANNED" ? (
              <button className="button secondary" type="button" disabled={busy} onClick={() => rejectPlan(run.id)}>رفض الخطة</button>
            ) : null}
            {run.status === "QUEUED" || run.status === "PLANNING" ? (
              <button className="button secondary" type="button" disabled={busy} onClick={() => cancelRun(run.id)}>إلغاء المهمة</button>
            ) : null}
          </article>
        ))}
        {runs.length === 0 ? <p className="muted">لا توجد مهام محفوظة حتى الآن.</p> : null}
      </div>
    </section>
  );
}
