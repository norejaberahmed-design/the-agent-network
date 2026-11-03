"use client";

import { useState } from "react";

type CreatedInvitation = {
  redemptionUrl: string;
  expiresAt: string;
};

type OrganizationOption = { id: string; name: string };

const invitationRoles = [
  { value: "VIEWER", label: "مشاهد — قراءة أساسية" },
  { value: "OPERATOR", label: "مشغّل" },
  { value: "AUDITOR", label: "مدقق" },
  { value: "AGENT_MANAGER", label: "مدير وكلاء" },
  { value: "ADMIN", label: "مدير مؤسسة" },
] as const;

export function InvitationCreateForm({
  organizations,
}: {
  organizations: OrganizationOption[];
}) {
  const [email, setEmail] = useState("");
  const [hours, setHours] = useState(72);
  const [organizationId, setOrganizationId] = useState("");
  const [role, setRole] = useState<(typeof invitationRoles)[number]["value"]>("VIEWER");
  const [created, setCreated] = useState<CreatedInvitation | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setCreated(null);
    setBusy(true);
    try {
      const response = await fetch("/api/admin/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim() || undefined,
          expiresInHours: hours,
          ...(organizationId ? { organizationId, role } : {}),
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(response.status === 403 ? "لا تملك صلاحية إنشاء الدعوات." : "تعذر إنشاء الدعوة.");
        return;
      }
      setCreated(body.data);
      setEmail("");
    } catch {
      setError("تعذر الاتصال بالخادم.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel" onSubmit={submit} style={{ display: "grid", gap: 14, marginBottom: 28 }}>
      <h2>دعوة عضو جديد</h2>
      <p className="muted" style={{ margin: 0 }}>يمكن إنشاء حساب عام أو ربط الحساب تلقائياً بمؤسسة ودور محدد عند قبول الدعوة.</p>
      <div className="field">
        <label htmlFor="invite-email">البريد المستهدف (اختياري)</label>
        <input id="invite-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" />
      </div>
      <div className="field">
        <label htmlFor="invite-organization">نطاق الدعوة</label>
        <select
          id="invite-organization"
          value={organizationId}
          onChange={(event) => setOrganizationId(event.target.value)}
        >
          <option value="">دعوة عامة — حساب على المنصة فقط</option>
          {organizations.map((organization) => (
            <option key={organization.id} value={organization.id}>{organization.name}</option>
          ))}
        </select>
      </div>
      {organizationId ? (
        <div className="field">
          <label htmlFor="invite-role">صلاحية العضو داخل المؤسسة</label>
          <select id="invite-role" value={role} onChange={(event) => setRole(event.target.value as typeof role)}>
            {invitationRoles.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
          <p className="muted" style={{ fontSize: 12 }}>لا تمنح الدعوة دور مالك المؤسسة. يمكن ترقية العضو لاحقاً من إدارة العضويات.</p>
        </div>
      ) : null}
      <div className="field">
        <label htmlFor="invite-hours">مدة الصلاحية بالساعات (1–168)</label>
        <input id="invite-hours" type="number" min={1} max={168} value={hours} onChange={(event) => setHours(Number(event.target.value))} />
      </div>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <div><button className="button" type="submit" disabled={busy}>{busy ? "جارٍ الإنشاء..." : "إنشاء دعوة"}</button></div>
      {created ? (
        <div className="panel">
          <strong>تم إنشاء رابط الدعوة — انسخه واحفظه الآن</strong>
          <input readOnly value={created.redemptionUrl} aria-label="رابط الدعوة" />
          <button className="button secondary" type="button" onClick={() => navigator.clipboard.writeText(created.redemptionUrl)}>نسخ الرابط</button>
          <p className="muted" style={{ fontSize: 12 }}>تنتهي صلاحية الدعوة: {new Date(created.expiresAt).toLocaleString("en-GB")}. لن يظهر الرابط مرة أخرى.</p>
        </div>
      ) : null}
    </form>
  );
}
