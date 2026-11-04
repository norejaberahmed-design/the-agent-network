"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Profile = {
  name: string;
  purpose: string;
  publicDescription: string | null;
  primaryLanguage: "ar" | "en";
  supportedLanguages: string[];
  configurationVersion: number;
};

export function AgentProfileEditor({
  agentId,
  initialProfile,
  canManage,
}: {
  agentId: string;
  initialProfile: Profile;
  canManage: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialProfile.name);
  const [purpose, setPurpose] = useState(initialProfile.purpose);
  const [publicDescription, setPublicDescription] = useState(initialProfile.publicDescription ?? "");
  const [primaryLanguage, setPrimaryLanguage] = useState<"ar" | "en">(initialProfile.primaryLanguage);
  const [supportedLanguages, setSupportedLanguages] = useState<string[]>(initialProfile.supportedLanguages);
  const [version, setVersion] = useState(initialProfile.configurationVersion);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  function toggleLanguage(language: "ar" | "en", checked: boolean) {
    setSupportedLanguages((current) => {
      const next = checked
        ? Array.from(new Set([...current, language]))
        : current.filter((item) => item !== language);
      if (next.length === 0) return current;
      if (!next.includes(primaryLanguage)) setPrimaryLanguage(next[0] as "ar" | "en");
      return next;
    });
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const response = await fetch(`/api/v1/agents/${encodeURIComponent(agentId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          configurationVersion: version,
          name,
          purpose,
          publicDescription: publicDescription.trim() || null,
          primaryLanguage,
          supportedLanguages,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        if (response.status === 409 && body.error?.code === "VERSION_CONFLICT") {
          setError("تغير ملف الوكيل في مكان آخر. حدّث الصفحة قبل إعادة المحاولة.");
        } else if (response.status === 409) {
          setError("لا يمكن تعديل الملف أثناء وجود مهام قيد الانتظار أو التنفيذ، أو لأن الوكيل ملغى نهائياً.");
        } else if (response.status === 403) {
          setError("ليس لديك صلاحية تعديل ملف هذا الوكيل.");
        } else {
          setError("تعذر حفظ الملف. تحقق من الحقول وحاول مجدداً.");
        }
        return;
      }
      const savedProfile = body.data as Profile;
      setVersion(savedProfile.configurationVersion);
      setName(savedProfile.name);
      setPurpose(savedProfile.purpose);
      setPublicDescription(savedProfile.publicDescription ?? "");
      setPrimaryLanguage(savedProfile.primaryLanguage);
      setSupportedLanguages(savedProfile.supportedLanguages);
      setSaved(true);
      router.refresh();
    } catch {
      setError("تعذر الاتصال بالخادم.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" style={{ marginBottom: 22, display: "grid", gap: 14 }}>
      <div>
        <h2>ملف الوكيل وهويته</h2>
        <p className="muted" style={{ margin: "6px 0 0" }}>
          هذه البيانات تصف هوية الوكيل وغرضه وطريقة تواصله. لا تمنحه صلاحية تنفيذ إجراءات خارجية.
        </p>
      </div>
      {!canManage ? (
        <p className="muted">يمكنك عرض ملف الوكيل، لكن لا تملك صلاحية تعديله.</p>
      ) : (
        <form onSubmit={save} style={{ display: "grid", gap: 13 }}>
          <div className="field">
            <label htmlFor="agent-profile-name">اسم الوكيل</label>
            <input id="agent-profile-name" value={name} minLength={2} maxLength={100} required onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="agent-profile-purpose">الغرض والمهام الأساسية</label>
            <textarea id="agent-profile-purpose" value={purpose} minLength={3} maxLength={1000} required rows={4} onChange={(event) => setPurpose(event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="agent-profile-description">وصف عام يمكن عرضه للآخرين</label>
            <textarea id="agent-profile-description" value={publicDescription} maxLength={500} rows={3} onChange={(event) => setPublicDescription(event.target.value)} placeholder="اختياري — لا تضع معلومات شخصية أو سرية هنا." />
          </div>
          <div className="field">
            <label htmlFor="agent-profile-primary-language">لغة الرد الأساسية</label>
            <select id="agent-profile-primary-language" value={primaryLanguage} onChange={(event) => setPrimaryLanguage(event.target.value as "ar" | "en")}>
              {supportedLanguages.includes("ar") ? <option value="ar">العربية</option> : null}
              {supportedLanguages.includes("en") ? <option value="en">English</option> : null}
            </select>
          </div>
          <fieldset style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 12, display: "flex", gap: 20, flexWrap: "wrap" }}>
            <legend style={{ paddingInline: 6, fontSize: 13, fontWeight: 700 }}>اللغات المدعومة</legend>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={supportedLanguages.includes("ar")} onChange={(event) => toggleLanguage("ar", event.target.checked)} />
              العربية
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={supportedLanguages.includes("en")} onChange={(event) => toggleLanguage("en", event.target.checked)} />
              English
            </label>
          </fieldset>
          {error ? <p className="error" role="alert">{error}</p> : null}
          {saved ? <p className="muted" role="status">تم حفظ ملف الوكيل وتسجيل التعديل.</p> : null}
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <button className="button" type="submit" disabled={busy || supportedLanguages.length === 0 || !supportedLanguages.includes(primaryLanguage)}>
              {busy ? "جارٍ الحفظ..." : "حفظ ملف الوكيل"}
            </button>
            <span className="muted" style={{ fontSize: 12 }}>إصدار الإعدادات: {version}</span>
          </div>
        </form>
      )}
    </section>
  );
}
