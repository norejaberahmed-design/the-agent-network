"use client";

import { useCallback, useEffect, useState } from "react";

type AuditEvent = {
  id: string;
  actor: { id: string; name: string } | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  outcome: string;
  policyVersion: string | null;
  occurredAt: string;
  metadata: Record<string, string | number | boolean | string[] | null>;
};

const actionLabels: Record<string, string> = {
  "organization.created": "إنشاء المؤسسة",
  "organization.member.role_changed": "تغيير دور عضو",
  "organization.member.removed": "إزالة عضو",
  "organization.member.invitations_revoked": "إلغاء دعوات عضو",
  "organization.member.grants_revoked": "إلغاء صلاحيات عضو",
  "agent.created": "إنشاء وكيل",
  "agent.lifecycle.updated": "تغيير حالة وكيل",
  "agent.field_policy.updated": "تعديل سياسة الخصوصية",
  "permission_grant.created": "إنشاء صلاحية",
  "permission_grant.revoked": "إلغاء صلاحية",
  "invitation.created": "إنشاء دعوة",
  "invitation.redeemed": "قبول دعوة",
  "action_approval.requested": "طلب موافقة على إجراء",
  "action_approval.approved": "الموافقة على إجراء",
  "action_approval.rejected": "رفض إجراء",
  "action_approval.expired": "انتهاء طلب موافقة",
  "action_approval.cancelled": "إلغاء طلب موافقة",
};

const metadataLabels: Record<string, string> = {
  initialStatus: "الحالة الأولية",
  discoverable: "قابل للاكتشاف",
  previousStatus: "الحالة السابقة",
  newStatus: "الحالة الجديدة",
  previousDiscoverable: "الإتاحة السابقة",
  newDiscoverable: "الإتاحة الجديدة",
  fieldKey: "الحقل",
  classification: "التصنيف",
  publicVisible: "ظاهر للعامة",
  previousVersion: "الإصدار السابق",
  actionScope: "نطاق الإجراء",
  targetScope: "نطاق الهدف",
  dataScope: "نطاق البيانات",
  expiresAt: "ينتهي في",
  maxUses: "الحد الأقصى للاستخدام",
  previousRole: "الدور السابق",
  newRole: "الدور الجديد",
  invitationCount: "عدد الدعوات الملغاة",
  grantCount: "عدد الصلاحيات الملغاة",
  reason: "السبب",
  actionType: "نوع الإجراء",
  recipient: "المستلم",
  payloadDigest: "بصمة الحمولة",
  requestedDataScope: "نطاق البيانات المطلوب",
  decision: "القرار",
  role: "الدور",
};

function displayValue(value: string | number | boolean | string[] | null) {
  if (value === null) return "—";
  if (typeof value === "boolean") return value ? "نعم" : "لا";
  if (Array.isArray(value)) return value.join("، ");
  return String(value);
}

export function AuditLogList({ organizationId }: { organizationId: string }) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (cursor?: string) => {
    setLoading(true);
    setError("");
    try {
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
      const response = await fetch(
        `/api/v1/organizations/${encodeURIComponent(organizationId)}/audit-events${query}`,
        { cache: "no-store" },
      );
      const body = await response.json();
      if (!response.ok) {
        setError("تعذر تحميل سجل التدقيق.");
        return;
      }
      setEvents((current) => cursor ? [...current, ...body.data] : body.data);
      setNextCursor(body.nextCursor);
    } catch {
      setError("تعذر الاتصال بالخادم أثناء تحميل السجل.");
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section style={{ paddingBottom: 60 }}>
      {error ? <p className="error" role="alert">{error}</p> : null}
      {events.length === 0 && !loading && !error ? (
        <div className="panel"><p>لا توجد أحداث تدقيق مسجلة لهذه المؤسسة بعد.</p></div>
      ) : null}
      <div className="list">
        {events.map((event) => (
          <article className="agent-row" key={event.id} style={{ alignItems: "flex-start" }}>
            <div style={{ minWidth: 0 }}>
              <strong>{actionLabels[event.action] ?? event.action}</strong>
              <p className="muted" style={{ margin: "5px 0", fontSize: 12 }}>
                المنفذ: {event.actor?.name ?? "حساب غير متاح"}
                {" · "}
                {new Date(event.occurredAt).toLocaleString("ar-SA")}
              </p>
              {event.targetType ? (
                <p className="muted" style={{ margin: "4px 0", fontSize: 12 }}>
                  الهدف: {event.targetType}{event.targetId ? ` · ${event.targetId}` : ""}
                </p>
              ) : null}
              {Object.keys(event.metadata).length > 0 ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                  {Object.entries(event.metadata).map(([key, value]) => (
                    <span className="pill" key={key}>
                      {metadataLabels[key] ?? key}: {displayValue(value)}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
            <span className="pill">{event.outcome}</span>
          </article>
        ))}
      </div>
      {nextCursor ? (
        <div style={{ marginTop: 18 }}>
          <button
            className="button secondary"
            type="button"
            onClick={() => void load(nextCursor)}
            disabled={loading}
          >
            {loading ? "جارٍ التحميل..." : "تحميل أحداث أقدم"}
          </button>
        </div>
      ) : null}
      {loading && events.length === 0 ? <p className="muted">جارٍ تحميل السجل...</p> : null}
    </section>
  );
}
