"use client";

import { useCallback, useEffect, useState } from "react";

type MemberRole = "OWNER" | "ADMIN" | "AGENT_MANAGER" | "OPERATOR" | "AUDITOR" | "VIEWER";
type AssignableRole = Exclude<MemberRole, "OWNER">;
type OrganizationMember = {
  id: string;
  role: MemberRole;
  createdAt: string;
  user: { id: string; name: string; email: string };
};

const roleLabels: Record<MemberRole, string> = {
  OWNER: "مالك المؤسسة",
  ADMIN: "مدير المؤسسة",
  AGENT_MANAGER: "مدير الوكلاء",
  OPERATOR: "مشغّل",
  AUDITOR: "مدقق",
  VIEWER: "مشاهد",
};

const assignableRoles: AssignableRole[] = [
  "ADMIN",
  "AGENT_MANAGER",
  "OPERATOR",
  "AUDITOR",
  "VIEWER",
];

export function OrganizationMembersPanel({
  organizationId,
  currentRole,
}: {
  organizationId: string;
  currentRole: "OWNER" | "ADMIN";
}) {
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [roleSelections, setRoleSelections] = useState<Record<string, AssignableRole>>({});
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<AssignableRole>("VIEWER");
  const [expiresInHours, setExpiresInHours] = useState(72);
  const [redemptionUrl, setRedemptionUrl] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");

  const loadMembers = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/v1/organizations/${encodeURIComponent(organizationId)}/members`,
        { cache: "no-store" },
      );
      const body = await response.json();
      if (!response.ok) {
        setError("تعذر تحميل أعضاء المؤسسة.");
        return;
      }
      setMembers(body.data);
      setRoleSelections((current) => {
        const next = { ...current };
        for (const member of body.data as OrganizationMember[]) {
          if (member.role !== "OWNER" && !next[member.id]) {
            next[member.id] = member.role;
          }
        }
        return next;
      });
    } catch {
      setError("تعذر الاتصال بالخادم أثناء تحميل الأعضاء.");
    }
  }, [organizationId]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  async function createInvitation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setRedemptionUrl("");
    setBusyKey("invite");
    try {
      const response = await fetch(
        `/api/v1/organizations/${encodeURIComponent(organizationId)}/invitations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim(), role: inviteRole, expiresInHours }),
        },
      );
      const body = await response.json();
      if (!response.ok) {
        setError(response.status === 403
          ? "لا تملك صلاحية دعوة هذا الدور."
          : "تعذر إنشاء الدعوة. تحقق من البريد ومدة الصلاحية.");
        return;
      }
      setRedemptionUrl(body.data.redemptionUrl);
      setEmail("");
    } catch {
      setError("تعذر الاتصال بالخادم أثناء إنشاء الدعوة.");
    } finally {
      setBusyKey("");
    }
  }

  async function updateRole(member: OrganizationMember) {
    const role = roleSelections[member.id] ?? member.role;
    if (role === member.role) return;
    setError("");
    setBusyKey(member.id);
    try {
      const response = await fetch(
        `/api/v1/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(member.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role }),
        },
      );
      if (!response.ok) {
        setError(response.status === 403
          ? "لا تملك صلاحية تغيير هذا الدور."
          : "تعذر تحديث العضوية.");
        return;
      }
      await loadMembers();
    } catch {
      setError("تعذر الاتصال بالخادم أثناء تحديث العضوية.");
    } finally {
      setBusyKey("");
    }
  }

  async function removeMember(member: OrganizationMember) {
    if (!window.confirm(`هل تريد إزالة ${member.user.name} من المؤسسة؟`)) return;
    setError("");
    setBusyKey(member.id);
    try {
      const response = await fetch(
        `/api/v1/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(member.id)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        setError(response.status === 403
          ? "لا تملك صلاحية إزالة هذا العضو."
          : "تعذر إزالة العضو.");
        return;
      }
      await loadMembers();
    } catch {
      setError("تعذر الاتصال بالخادم أثناء إزالة العضو.");
    } finally {
      setBusyKey("");
    }
  }

  return (
    <section className="panel" style={{ display: "grid", gap: 18, marginBottom: 28 }}>
      <div>
        <h2>إدارة أعضاء المؤسسة</h2>
        <p className="muted" style={{ margin: "6px 0 0" }}>
          صلاحيات العضوية منفصلة عن ملكية المؤسسة. لا يمكن نقل دور المالك من هذه الشاشة.
        </p>
      </div>

      <form onSubmit={createInvitation} style={{ display: "grid", gap: 12 }}>
        <h3>دعوة عضو جديد</h3>
        <div className="field">
          <label htmlFor="org-member-email">البريد الإلكتروني للعضو</label>
          <input
            id="org-member-email"
            type="email"
            required
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="member@example.com"
          />
        </div>
        <div className="field">
          <label htmlFor="org-member-role">الدور عند قبول الدعوة</label>
          <select
            id="org-member-role"
            value={inviteRole}
            onChange={(event) => setInviteRole(event.target.value as AssignableRole)}
          >
            {assignableRoles
              .filter((role) => currentRole === "OWNER" || role !== "ADMIN")
              .map((role) => (
                <option key={role} value={role}>{roleLabels[role]}</option>
              ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="org-invite-expiry">صلاحية الرابط بالساعات (1–168)</label>
          <input
            id="org-invite-expiry"
            type="number"
            min={1}
            max={168}
            required
            value={expiresInHours}
            onChange={(event) => setExpiresInHours(Number(event.target.value))}
          />
        </div>
        <div>
          <button className="button" type="submit" disabled={busyKey === "invite" || !email.trim()}>
            {busyKey === "invite" ? "جارٍ إنشاء الدعوة..." : "إنشاء رابط دعوة"}
          </button>
        </div>
        {redemptionUrl ? (
          <div className="panel">
            <strong>رابط الدعوة — انسخه وشاركه مع العضو</strong>
            <input readOnly value={redemptionUrl} aria-label="رابط دعوة عضو المؤسسة" />
            <button
              className="button secondary"
              type="button"
              onClick={() => navigator.clipboard.writeText(redemptionUrl)}
            >
              نسخ الرابط
            </button>
            <p className="muted" style={{ fontSize: 12 }}>
              الرابط أحادي الاستخدام ومقيد بالبريد المحدد، ولا يُعرض مرة أخرى بعد مغادرة هذه الشاشة.
            </p>
          </div>
        ) : null}
      </form>

      {error ? <p className="error" role="alert">{error}</p> : null}

      <div>
        <h3>الأعضاء ({members.length})</h3>
        {members.length === 0 ? (
          <p className="muted">لا يوجد أعضاء مسجلون.</p>
        ) : (
          <div className="list">
            {members.map((member) => {
              const protectedAdmin = currentRole === "ADMIN" && member.role === "ADMIN";
              const editable = member.role !== "OWNER" && !protectedAdmin;
              const selectedRole = roleSelections[member.id] ?? (
                member.role === "OWNER" ? "VIEWER" : member.role
              );
              return (
                <article className="agent-row" key={member.id}>
                  <div style={{ minWidth: 0 }}>
                    <strong>{member.user.name}</strong>
                    <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
                      {member.user.email}
                    </p>
                    <span className="pill">{roleLabels[member.role]}</span>
                  </div>
                  {editable ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                      <select
                        aria-label={`دور ${member.user.name}`}
                        value={selectedRole}
                        onChange={(event) => setRoleSelections((current) => ({
                          ...current,
                          [member.id]: event.target.value as AssignableRole,
                        }))}
                        disabled={busyKey === member.id}
                      >
                        {assignableRoles
                          .filter((role) => currentRole === "OWNER" || role !== "ADMIN")
                          .map((role) => (
                            <option key={role} value={role}>{roleLabels[role]}</option>
                          ))}
                      </select>
                      <button
                        className="button secondary"
                        type="button"
                        onClick={() => void updateRole(member)}
                        disabled={busyKey === member.id || selectedRole === member.role}
                      >
                        حفظ الدور
                      </button>
                      <button
                        className="button secondary"
                        type="button"
                        onClick={() => void removeMember(member)}
                        disabled={busyKey === member.id}
                      >
                        إزالة
                      </button>
                    </div>
                  ) : (
                    <span className="muted">{member.role === "OWNER" ? "صلاحية محمية" : "إدارة المالك فقط"}</span>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
