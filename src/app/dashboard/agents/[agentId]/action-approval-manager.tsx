"use client";

import { useCallback, useEffect, useState } from "react";

type GrantOption = {
  id: string;
  actionScope: string[];
  targetScope: string[];
  dataScope: string[];
  status: string;
  expiresAt: string;
};

type Approval = {
  id: string;
  actionType: string;
  recipient: string;
  requestedDataScope: string[];
  payloadDigest: string;
  payloadPreview: unknown;
  status: string;
  expiresAt: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  decisionReason: string | null;
  createdAt: string;
  requester: { id: string; name: string };
  approver: { id: string; name: string } | null;
};

export function ActionApprovalManager({
  agentId,
  currentUserId,
  canRequest,
  canApprove,
  grants,
}: {
  agentId: string;
  currentUserId: string;
  canRequest: boolean;
  canApprove: boolean;
  grants: GrantOption[];
}) {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [grantId, setGrantId] = useState(grants[0]?.id ?? "");
  const [actionType, setActionType] = useState("SEND_MESSAGE");
  const [recipient, setRecipient] = useState(grants[0]?.targetScope[0] ?? "");
  const [dataScopeText, setDataScopeText] = useState(grants[0]?.dataScope[0] ?? "");
  const [payloadText, setPayloadText] = useState('{ "message": "Hello" }');
  const [expiresInMinutes, setExpiresInMinutes] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadApprovals = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/v1/agents/${encodeURIComponent(agentId)}/approvals`,
        { cache: "no-store" },
      );
      const body = await response.json();
      if (!response.ok) {
        setError("تعذر تحميل طلبات الموافقة.");
        return;
      }
      setApprovals(body.data);
    } catch {
      setError("تعذر الاتصال بالخادم لتحميل طلبات الموافقة.");
    }
  }, [agentId]);

  useEffect(() => {
    void loadApprovals();
  }, [loadApprovals]);

  async function submitRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    let payload: unknown;
    try {
      payload = JSON.parse(payloadText);
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("payload must be an object");
      }
    } catch {
      setError("صيغة الحمولة غير صالحة. أدخل كائن JSON صحيحاً.");
      setBusy(false);
      return;
    }

    const requestedDataScope = dataScopeText.split(",").map((item) => item.trim()).filter(Boolean);
    try {
      const response = await fetch(
        `/api/v1/agents/${encodeURIComponent(agentId)}/approvals`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            grantId,
            actionType: actionType.trim(),
            recipient: recipient.trim(),
            requestedDataScope,
            payload,
            expiresInMinutes,
            idempotencyKey: window.crypto.randomUUID(),
          }),
        },
      );
      if (!response.ok) {
        setError(response.status === 403
          ? "نطاق الإجراء أو الهدف أو البيانات غير مشمول في الصلاحية."
          : "تعذر إنشاء طلب الموافقة.");
        return;
      }
      setNotice("تم تسجيل طلب الموافقة. لم يتم تنفيذ أي إجراء خارجي.");
      await loadApprovals();
    } catch {
      setError("تعذر الاتصال بالخادم لإنشاء طلب الموافقة.");
    } finally {
      setBusy(false);
    }
  }

  async function decide(approvalId: string, decision: "APPROVE" | "REJECT") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/v1/approvals/${encodeURIComponent(approvalId)}/decision`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            decision,
            reason: decision === "APPROVE" ? "Reviewed by authorized owner/admin." : "Rejected by authorized owner/admin.",
          }),
        },
      );
      if (!response.ok) {
        setError(response.status === 403
          ? "لا تملك صلاحية اتخاذ القرار أو لا يمكن الموافقة على طلبك الشخصي."
          : "تعذر تسجيل قرار الموافقة.");
        return;
      }
      setNotice(decision === "APPROVE" ? "تمت الموافقة على الطلب." : "تم رفض الطلب.");
      await loadApprovals();
    } catch {
      setError("تعذر الاتصال بالخادم لتسجيل القرار.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" style={{ display: "grid", gap: 16, marginTop: 22 }}>
      <div>
        <h2>موافقات الإجراءات</h2>
        <p className="muted" style={{ margin: "6px 0 0" }}>
          ترتبط الموافقة ببصمة الحمولة والهدف ونطاق البيانات والصلاحية. تسجيل الموافقة لا ينفذ الإجراء.
        </p>
      </div>

      {canRequest ? (
        <form onSubmit={submitRequest} style={{ display: "grid", gap: 12 }}>
          <h3>طلب موافقة بشرية</h3>
          <div className="field">
            <label htmlFor="approval-grant">الصلاحية المستخدمة</label>
            <select
              id="approval-grant"
              value={grantId}
              onChange={(event) => {
                const nextId = event.target.value;
                const selected = grants.find((grant) => grant.id === nextId);
                setGrantId(nextId);
                if (selected) {
                  setActionType(selected.actionScope[0] ?? "SEND_MESSAGE");
                  setRecipient(selected.targetScope[0] ?? "");
                  setDataScopeText(selected.dataScope[0] ?? "");
                }
              }}
              required
            >
              {grants.map((grant) => (
                <option key={grant.id} value={grant.id}>
                  {grant.id} · {grant.actionScope.join(", ")}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="approval-action">نوع الإجراء</label>
            <input id="approval-action" value={actionType} onChange={(event) => setActionType(event.target.value)} required maxLength={100} />
          </div>
          <div className="field">
            <label htmlFor="approval-recipient">المستلم / الهدف</label>
            <input id="approval-recipient" value={recipient} onChange={(event) => setRecipient(event.target.value)} required maxLength={512} />
          </div>
          <div className="field">
            <label htmlFor="approval-data-scope">نطاق البيانات المطلوب (مفصول بفواصل)</label>
            <input id="approval-data-scope" value={dataScopeText} onChange={(event) => setDataScopeText(event.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="approval-payload">حمولة الإجراء بصيغة JSON</label>
            <textarea id="approval-payload" value={payloadText} onChange={(event) => setPayloadText(event.target.value)} rows={5} />
          </div>
          <div className="field">
            <label htmlFor="approval-expiry">انتهاء الطلب بالدقائق (1–1440)</label>
            <input id="approval-expiry" type="number" min={1} max={1440} value={expiresInMinutes} onChange={(event) => setExpiresInMinutes(Number(event.target.value))} />
          </div>
          <div>
            <button className="button" type="submit" disabled={busy || !grantId}>
              {busy ? "جارٍ الإرسال..." : "إرسال للموافقة"}
            </button>
          </div>
          {grants.length === 0 ? <p className="muted">أنشئ صلاحية نشطة أولاً حتى تتمكن من طلب الموافقة.</p> : null}
        </form>
      ) : null}

      {error ? <p className="error" role="alert">{error}</p> : null}
      {notice ? <p className="muted" role="status">{notice}</p> : null}

      <div>
        <h3>طلبات الموافقة ({approvals.length})</h3>
        {approvals.length === 0 ? <p className="muted">لا توجد طلبات موافقة.</p> : null}
        <div className="list">
          {approvals.map((approval) => (
            <article className="agent-row" key={approval.id} style={{ alignItems: "flex-start" }}>
              <div style={{ minWidth: 0 }}>
                <strong>{approval.actionType}</strong>
                <p className="muted" style={{ margin: "4px 0", fontSize: 12 }}>
                  المستلم: {approval.recipient} · مقدم الطلب: {approval.requester.name}
                </p>
                <p className="muted" style={{ margin: "4px 0", fontSize: 12 }}>
                  نطاق البيانات: {approval.requestedDataScope.join("، ")}
                </p>
                <p className="muted" style={{ margin: "4px 0", fontSize: 12 }}>
                  بصمة الحمولة: {approval.payloadDigest.slice(0, 16)}…
                </p>
                <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12 }}>
                  {JSON.stringify(approval.payloadPreview, null, 2)}
                </pre>
                <p className="muted" style={{ margin: "4px 0", fontSize: 12 }}>
                  ينتهي: {new Date(approval.expiresAt).toLocaleString("ar-SA")}
                  {approval.approver ? ` · القرار بواسطة: ${approval.approver.name}` : ""}
                </p>
                {approval.decisionReason ? <p className="muted">{approval.decisionReason}</p> : null}
                {canApprove && approval.status === "PENDING" && approval.requester.id !== currentUserId ? (
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button className="button" type="button" disabled={busy} onClick={() => void decide(approval.id, "APPROVE")}>موافقة</button>
                    <button className="button secondary" type="button" disabled={busy} onClick={() => void decide(approval.id, "REJECT")}>رفض</button>
                  </div>
                ) : null}
              </div>
              <span className="pill">{approval.status}</span>
            </article>
          ))}
        </div>
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        لا يوجد في هذه المرحلة منفذ لإرسال الرسائل أو تشغيل الأدوات. هذه الشاشة تسجل الطلب وتوثق قرار الإنسان فقط.
      </p>
    </section>
  );
}
