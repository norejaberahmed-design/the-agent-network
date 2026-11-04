"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Mode = "search" | "ad";
type SearchResult = { title: string; url: string; snippet: string };
type AgentResponse = { mode: Mode; summary: string; results?: SearchResult[]; draft?: string };

const starterPrompts = [
  "ابحث عن شركات سعودية تشتري معدات الشبكات بالجملة",
  "اكتب إعلاناً احترافياً لمنتج أريد بيعه",
  "قارن بين أفضل الخيارات مع ذكر المصادر",
];

export default function AgentWorkspace() {
  const [displayName, setDisplayName] = useState("وكيلك الشخصي");
  const [tone, setTone] = useState("واضح ومباشر");
  const [goal, setGoal] = useState("البحث عن الفرص وبناء دخل حلال");
  const [mode, setMode] = useState<Mode>("search");
  const [task, setTask] = useState("");
  const [busy, setBusy] = useState(false);
  const [response, setResponse] = useState<AgentResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("tan-agent-profile-v1");
      if (saved) {
        const profile = JSON.parse(saved) as { displayName?: string; tone?: string; goal?: string };
        if (profile.displayName) setDisplayName(profile.displayName);
        if (profile.tone) setTone(profile.tone);
        if (profile.goal) setGoal(profile.goal);
      }
    } catch { /* Ignore invalid local profile data. */ }
  }, []);

  function saveProfile() {
    localStorage.setItem("tan-agent-profile-v1", JSON.stringify({ displayName, tone, goal }));
    setError("");
  }

  async function runTask(value = task) {
    if (!value.trim() || busy) return;
    setBusy(true);
    setError("");
    setResponse(null);
    try {
      const res = await fetch("/api/demo-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, task: value, profile: { displayName, tone, goal } }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "تعذر تنفيذ الطلب.");
      setResponse(body as AgentResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "حدث خطأ غير متوقع.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="agent-shell">
      <header className="agent-topbar">
        <Link className="agent-brand" href="/"><span className="agent-mark">A</span><span>The Agent Network<small>وكيلك الشخصي · مساحة العمل</small></span></Link>
        <div className="agent-header-actions"><Link className="agent-login" href="/sign-in">دخول الأعضاء</Link><span className="agent-status"><i /> نموذج تجريبي مباشر</span></div>
      </header>

      <section className="agent-layout">
        <aside className="agent-sidebar">
          <div className="agent-profile-head"><div className="agent-avatar">✦</div><div><strong>{displayName || "وكيلك الشخصي"}</strong><small>يمثّل أهدافك وأسلوبك</small></div></div>
          <div className="agent-side-section">
            <span className="agent-overline">هويتك الرقمية</span>
            <label>اسم الوكيل<input value={displayName} onChange={e => setDisplayName(e.target.value)} maxLength={60} /></label>
            <label>أسلوب التواصل<select value={tone} onChange={e => setTone(e.target.value)}><option>واضح ومباشر</option><option>رسمي واحترافي</option><option>ودود ومقنع</option><option>تحليلي ودقيق</option></select></label>
            <label>هدفك الأساسي<textarea value={goal} onChange={e => setGoal(e.target.value)} rows={3} maxLength={240} /></label>
            <button className="agent-save" onClick={saveProfile}>حفظ الهوية على هذا الجهاز</button>
            <small className="agent-local-note">تُحفظ هذه التفضيلات محلياً في متصفحك فقط حالياً.</small>
          </div>
          <div className="agent-side-note"><strong>أنت صاحب القرار</strong><p>هذه النسخة لا ترسل رسائل ولا تنفذ عمليات شراء أو تعاقد. ستبقى أي خطوة خارجية بحاجة إلى موافقتك.</p></div>
        </aside>

        <section className="agent-main">
          <div className="agent-welcome">
            <span className="agent-overline">YOUR PERSONAL AI REPRESENTATIVE</span>
            <h1>مرحباً، ما الذي تريد<br /><em>أن أنجزه لك اليوم؟</em></h1>
            <p>اكتب طلبك بلغتك الطبيعية. أبحث لك في الويب أو أساعدك في إعداد إعلانك، مع توضيح ما تم فعله فعلياً.</p>
          </div>

          <div className="agent-composer-card">
            <div className="agent-mode-switch">
              <button className={mode === "search" ? "selected" : ""} onClick={() => { setMode("search"); setResponse(null); }}>⌕ البحث والاكتشاف</button>
              <button className={mode === "ad" ? "selected" : ""} onClick={() => { setMode("ad"); setResponse(null); }}>✧ إعداد إعلان</button>
            </div>
            <textarea value={task} onChange={e => setTask(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void runTask(); } }} placeholder={mode === "search" ? "مثال: ابحث عن موزعي معدات الشبكات في السعودية، واجمع المواقع الرسمية..." : "اكتب تفاصيل المنتج أو الخدمة والجمهور الذي تريد الوصول إليه..."} rows={4} maxLength={1200} />
            <div className="agent-compose-bottom"><span>النتائج تعتمد على الطلب والمصادر المتاحة · {task.length}/1200</span><button onClick={() => void runTask()} disabled={busy || !task.trim()}>{busy ? "جارٍ العمل..." : "ابدأ المهمة"} <b>←</b></button></div>
          </div>

          {!response && !busy && <div className="agent-suggestions"><span>جرّب أن تطلب</span>{starterPrompts.map(p => <button key={p} onClick={() => { setMode(p.includes("إعلان") ? "ad" : "search"); setTask(p); }}>{p} <b>↗</b></button>)}</div>}
          {busy && <div className="agent-result-card agent-loading"><span className="agent-spinner" /> أعمل على طلبك الآن...</div>}
          {error && <div className="agent-error" role="alert">{error}</div>}
          {response && <section className="agent-result-card" aria-live="polite">
            <div className="agent-result-heading"><span className="agent-overline">نتيجة المهمة</span><span className="agent-result-tag">{response.mode === "search" ? "بحث ويب" : "مسودة إعلان"}</span></div>
            <h2>{response.summary}</h2>
            {response.results?.length ? <div className="agent-search-results">{response.results.map((r, i) => <article key={r.url}><span>{String(i + 1).padStart(2, "0")}</span><div><a href={r.url} target="_blank" rel="noreferrer">{r.title} ↗</a><p>{r.snippet}</p><small>{new URL(r.url).hostname}</small></div></article>)}</div> : null}
            {response.results?.length === 0 ? <p>لم أجد نتائج قابلة للاستخراج لهذا الاستعلام. جرّب صياغة أكثر تحديداً.</p> : null}
            {response.draft ? <div className="agent-ad-draft"><pre>{response.draft}</pre><button onClick={() => void navigator.clipboard.writeText(response.draft || "")}>نسخ المسودة</button></div> : null}
            <p className="agent-disclaimer">تنبيه الشفافية: البحث يجلب نتائج عامة مباشرة. إعداد الإعلان في هذه النسخة قالب أولي، وليس نصاً مولداً بواسطة نموذج OpenAI بعد.</p>
          </section>}
          <footer className="agent-footer">THE AGENT NETWORK <span>نسخة تجريبية أولية · لا تمثل اعتماداً أو شراكة مع OpenAI</span></footer>
        </section>
      </section>
    </main>
  );
}
