"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ProfileForm({
  initialName,
  email,
  createdAt,
}: {
  initialName: string;
  email: string;
  createdAt: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const response = await fetch("/api/v1/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(response.status === 422
          ? "الاسم يجب أن يتكون من حرفين إلى 80 حرفاً."
          : "تعذر حفظ الملف الشخصي. حاول مرة أخرى.");
        return;
      }
      setName(body.data.name);
      setSaved(true);
      router.refresh();
    } catch {
      setError("تعذر الاتصال بالخادم.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel" onSubmit={submit} style={{ display: "grid", gap: 16, maxWidth: 620, marginBottom: 60 }}>
      <div className="field">
        <label htmlFor="profile-name">اسم العرض</label>
        <input id="profile-name" value={name} minLength={2} maxLength={80} required onChange={(event) => setName(event.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="profile-email">البريد الإلكتروني</label>
        <input id="profile-email" value={email} readOnly disabled />
        <span className="muted" style={{ fontSize: 12 }}>تغيير البريد يتطلب مسار تحقق مستقل، وهو غير متاح حالياً.</span>
      </div>
      <div className="field">
        <label>تاريخ إنشاء الحساب</label>
        <input value={new Date(createdAt).toLocaleDateString("ar-SA")} readOnly disabled />
      </div>
      {error ? <p className="error" role="alert">{error}</p> : null}
      {saved ? <p className="muted" role="status">تم حفظ اسم العرض.</p> : null}
      <div><button className="button" type="submit" disabled={busy || name.trim() === initialName}>{busy ? "جارٍ الحفظ..." : "حفظ التغييرات"}</button></div>
    </form>
  );
}
