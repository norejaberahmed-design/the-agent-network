"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";

type Memory = {
  id: string;
  kind: "CONFIRMED" | "INFERRED" | "TASK_CONTEXT";
  content: string;
  purpose: string;
  sourceReference: string | null;
  confidence: number | null;
  classification: string;
  sourceType: string;
  status: string;
  expiresAt: string | null;
};

export default function MemoryManager() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/v1/me/memories", { cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 401 ? "سجّل الدخول لإدارة ذاكرتك." : "تعذر تحميل الذاكرة.");
      const body = await response.json();
      setMemories((body.data || []) as Memory[]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذر تحميل الذاكرة.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function addMemory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (content.trim().length < 2 || saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/v1/me/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "CONFIRMED",
          content,
          purpose: "Personalize the owner's agent responses",
          classification: "CONTEXTUAL",
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "تعذر حفظ المعلومة.");
      setContent("");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذر حفظ المعلومة.");
    } finally {
      setSaving(false);
    }
  }

  async function updateMemory(id: string, action: "confirm" | "archive" | "delete" | "save") {
    setError("");
    try {
      const response = action === "delete"
        ? await fetch(`/api/v1/me/memories/${encodeURIComponent(id)}`, { method: "DELETE" })
        : await fetch(`/api/v1/me/memories/${encodeURIComponent(id)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(action === "confirm" ? { confirm: true } : action === "save" ? { content: editingContent } : { status: "ARCHIVED" }),
          });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "تعذر تحديث الذاكرة.");
      setEditingId(null);
      setEditingContent("");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذر تحديث الذاكرة.");
    }
  }

  return (
    <section className="agent-side-section" aria-labelledby="personal-memory-title">
      <span className="agent-overline">ذاكرتك الشخصية</span>
      <h2 id="personal-memory-title">ما الذي ينبغي أن يتذكره وكيلك؟</h2>
      <p className="agent-local-note">أضف الحقائق التي تؤكدها بنفسك. لا تُستخدم المعلومات الخاصة أو شديدة الحساسية في سياق الذكاء الاصطناعي.</p>
      <form onSubmit={addMemory}>
        <label>
          معلومة مؤكدة
          <textarea value={content} onChange={event => setContent(event.target.value)} rows={3} maxLength={2000} placeholder="مثال: أفضل أن تكون الرسائل مختصرة وواضحة." />
        </label>
        <button className="agent-save" type="submit" disabled={saving || content.trim().length < 2}>
          {saving ? "جارٍ الحفظ..." : "إضافة إلى ذاكرتي"}
        </button>
      </form>
      {loading ? <small>جارٍ تحميل الذاكرة...</small> : null}
      {memories.map(memory => (
        <article key={memory.id} className="agent-memory-item">
          {editingId === memory.id ? (
            <>
              <textarea value={editingContent} onChange={event => setEditingContent(event.target.value)} rows={3} maxLength={2000} />
              <div className="agent-memory-actions">
                <button type="button" disabled={editingContent.trim().length < 2} onClick={() => void updateMemory(memory.id, "save")}>حفظ التصحيح</button>
                <button type="button" onClick={() => setEditingId(null)}>إلغاء</button>
              </div>
            </>
          ) : <p>{memory.content}</p>}
          <small>{memory.kind === "CONFIRMED" ? "معلومة مؤكدة منك" : memory.kind === "INFERRED" ? `استنتاج · ثقة ${Math.round((memory.confidence || 0) * 100)}٪` : "سياق مؤقت"}</small>
          {memory.sourceReference ? <small>المصدر: {memory.sourceReference}</small> : null}
          <div className="agent-memory-actions">
            {memory.kind === "INFERRED" ? <button type="button" onClick={() => void updateMemory(memory.id, "confirm")}>أؤكد المعلومة</button> : null}
            {editingId !== memory.id ? <button type="button" onClick={() => { setEditingId(memory.id); setEditingContent(memory.content); }}>تصحيح</button> : null}
            <button type="button" onClick={() => void updateMemory(memory.id, "archive")}>أرشفة</button>
            <button type="button" onClick={() => void updateMemory(memory.id, "delete")}>حذف</button>
          </div>
        </article>
      ))}
      {error ? <p role="alert" className="agent-error">{error}</p> : null}
      {!loading && memories.length === 0 && !error ? <small>لا توجد معلومات محفوظة بعد.</small> : null}
    </section>
  );
}
