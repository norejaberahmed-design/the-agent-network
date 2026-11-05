"use client";

import { useCallback, useEffect, useState } from "react";

type Suggestion = {
  id: string;
  content: string;
  evidenceExcerpt: string;
  confidence: number;
  version: number;
  createdAt: string;
  sourceRun: { id: string; createdAt: string };
};

export default function MemorySuggestionManager() {
  const [items, setItems] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editedContent, setEditedContent] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/v1/me/memory-suggestions", { cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 401 ? "سجّل الدخول لمراجعة اقتراحات الذاكرة." : "تعذر تحميل الاقتراحات.");
      const body = await response.json();
      setItems((body.data || []) as Suggestion[]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذر تحميل الاقتراحات.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function review(item: Suggestion, action: "ACCEPT" | "REJECT") {
    if (busyId) return;
    setBusyId(item.id);
    setError("");
    try {
      const response = await fetch("/api/v1/me/memory-suggestions/" + encodeURIComponent(item.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          version: item.version,
          ...(action === "ACCEPT" && editingId === item.id && editedContent.trim()
            ? { content: editedContent.trim() }
            : {}),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "تعذر تسجيل قرار المراجعة.");
      setEditingId(null);
      setEditedContent("");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذر تسجيل قرار المراجعة.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="agent-side-section" aria-labelledby="memory-suggestions-title">
      <span className="agent-overline">مراجعة التعلم</span>
      <h2 id="memory-suggestions-title">اقتراحات تنتظر قرارك</h2>
      <p className="agent-local-note">نستخرج فقط تفضيلات تواصل صريحة ومحددة من مهامك، دون استنتاج صفات حساسة. لا تُضاف أي معلومة إلى الذاكرة المؤكدة قبل قبولك.</p>
      {loading ? <small>جارٍ تحميل الاقتراحات...</small> : null}
      {items.map(item => (
        <article key={item.id} className="agent-memory-item">
          {editingId === item.id ? (
            <textarea value={editedContent} onChange={event => setEditedContent(event.target.value)} rows={3} maxLength={2000} />
          ) : <p>{item.content}</p>}
          <small>الثقة الأولية: {Math.round(item.confidence * 100)}٪ · من مهمة بتاريخ {new Date(item.sourceRun.createdAt).toLocaleDateString("ar-SA")}</small>
          <small>الشاهد من نص المهمة: «{item.evidenceExcerpt}»</small>
          <div className="agent-memory-actions">
            {editingId !== item.id ? (
              <button type="button" onClick={() => { setEditingId(item.id); setEditedContent(item.content); }}>تعديل قبل القبول</button>
            ) : (
              <button type="button" onClick={() => { setEditingId(null); setEditedContent(""); }}>إلغاء التعديل</button>
            )}
            <button type="button" disabled={busyId !== null || (editingId === item.id && editedContent.trim().length < 2)} onClick={() => void review(item, "ACCEPT")}>
              {busyId === item.id ? "جارٍ الحفظ..." : "قبول وإضافته للذاكرة"}
            </button>
            <button type="button" disabled={busyId !== null} onClick={() => void review(item, "REJECT")}>رفض الاقتراح</button>
          </div>
        </article>
      ))}
      {error ? <p role="alert" className="agent-memory-error">{error}</p> : null}
      {!loading && items.length === 0 && !error ? <small>لا توجد اقتراحات معلّقة حالياً.</small> : null}
    </section>
  );
}
