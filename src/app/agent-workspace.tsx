"use client";

import Link from "next/link";
import MemoryManager from "./memory-manager";
import { useEffect, useState } from "react";

type Mode = "search" | "ad";
type SearchResult = { title: string; url: string; snippet: string };
type AgentResponse = { mode: Mode; summary: string; results?: SearchResult[]; draft?: string };
type PersonalAgent = { id: string; name: string; status: string };
type PermissionGrant = {
  id: string; purpose: string; actionScope: string[]; targetScope: string[];
  dataScope: string[]; expiresAt: string; maxUses: number | null; uses: number; status: string;
};
type AgentRun = {
  id: string; task: string; status: string; planSummary?: string | null;
  planSources?: Array<{ url: string; title: string; evidence?: Array<{ claim: string }> }> | null;
  steps?: Array<{ stepId: string; action: string; description: string; status: string }>;
  errorCode?: string | null; createdAt: string; completedAt?: string | null;
};

const starterPrompts = [
  "ابحث عن شركات سعودية تشتري معدات الشبكات بالجملة",
  "اكتب إعلاناً احترافياً لمنتج أريد بيعه",
  "قارن بين أفضل الخيارات مع ذكر المصادر",
];

export default function AgentWorkspace() {
  const [displayName, setDisplayName] = useState("وكيلك الشخصي");
  const [tone, setTone] = useState("واضح ومباشر");
  const [goal, setGoal] = useState("البحث عن الفرص وبناء دخل حلال");
  const [memoryContextEnabled, setMemoryContextEnabled] = useState(false);
  const [mode, setMode] = useState<Mode>("search");
  const [task, setTask] = useState("");
  const [busy, setBusy] = useState(false);
  const [response, setResponse] = useState<AgentResponse | null>(null);
  const [error, setError] = useState("");
  const [profileStorage, setProfileStorage] = useState<"checking" | "account" | "device" | "error">("checking");
  const [accountState, setAccountState] = useState<"checking" | "guest" | "ready" | "error">("checking");
  const [agents, setAgents] = useState<PersonalAgent[]>([]);
  const [agentId, setAgentId] = useState("");
  const [grants, setGrants] = useState<PermissionGrant[]>([]);
  const [grantId, setGrantId] = useState("");
  const [providerConsent, setProviderConsent] = useState(false);
  const [runtimeRun, setRuntimeRun] = useState<AgentRun | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("tan-agent-profile-v1");
      if (saved) {
        const profile = JSON.parse(saved) as { displayName?: string; tone?: string; goal?: string; memoryContextEnabled?: boolean };
        if (profile.displayName) setDisplayName(profile.displayName);
        if (profile.tone) setTone(profile.tone);
        if (profile.goal) setGoal(profile.goal);
        if (typeof profile.memoryContextEnabled === "boolean") setMemoryContextEnabled(profile.memoryContextEnabled);
      }
    } catch { /* Ignore invalid local profile data. */ }

    let active = true;
    void fetch("/api/v1/me/persona", { cache: "no-store" })
      .then(async response => {
        if (!active) return;
        if (response.status === 401) {
          setProfileStorage("device");
          return;
        }
        if (!response.ok) {
          setProfileStorage("error");
          return;
        }
        const body = await response.json();
        if (!active) return;
        if (body.data) {
          setDisplayName(body.data.displayName);
          setTone(body.data.tone);
          setGoal(body.data.goal);
          setMemoryContextEnabled(Boolean(body.data.memoryContextEnabled));
        }
        setProfileStorage("account");
      })
      .catch(() => { if (active) setProfileStorage("error"); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    void fetch("/api/v1/agents", { cache: "no-store" })
      .then(async response => {
        if (!active) return;
        if (response.status === 401) { setAccountState("guest"); return; }
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "تعذر تحميل وكلائك.");
        const owned = (body.data || []) as PersonalAgent[];
        if (!active) return;
        setAgents(owned);
        setAccountState("ready");
        const firstActive = owned.find(agent => agent.status === "ACTIVE");
        if (firstActive) setAgentId(firstActive.id);
      })
      .catch(() => { if (active) setAccountState("error"); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!agentId) { setGrants([]); setGrantId(""); return; }
    let active = true;
    void Promise.all([
      fetch(`/api/v1/agents/${encodeURIComponent(agentId)}/grants`, { cache: "no-store" }),
      fetch(`/api/v1/agents/${encodeURIComponent(agentId)}/runs`, { cache: "no-store" }),
    ]).then(async ([grantResponse, runResponse]) => {
      if (!active) return;
      if (grantResponse.status === 401 || runResponse.status === 401) {
        setAccountState("guest");
        return;
      }
      const grantBody = await grantResponse.json();
      const runBody = await runResponse.json();
      if (!grantResponse.ok || !runResponse.ok) throw new Error("تعذر تحميل صلاحيات ومهام الوكيل.");
      const now = Date.now();
      const available = ((grantBody.data || []) as PermissionGrant[]).filter(grant =>
        grant.status === "ACTIVE" && new Date(grant.expiresAt).getTime() > now &&
        grant.actionScope.includes("SEARCH_PUBLIC_WEB") &&
        grant.targetScope.includes("PUBLIC_WEB") &&
        grant.dataScope.includes("PUBLIC_PROFILE") &&
        (grant.maxUses === null || grant.uses < grant.maxUses)
      );
      setGrants(available);
      setGrantId(current => available.some(grant => grant.id === current) ? current : (available[0]?.id || ""));
      const runs = (runBody.data || []) as AgentRun[];
      if (runs[0]) setRuntimeRun(runs[0]);
    }).catch(() => { if (active) setError("تعذر تحميل بيانات الوكيل. حدّث الصفحة أو افتح مساحة الحساب."); });
    return () => { active = false; };
  }, [agentId]);

  useEffect(() => {
    if (!agentId || !runtimeRun || !["QUEUED", "PLANNING"].includes(runtimeRun.status)) return;
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch(`/api/v1/agents/${encodeURIComponent(agentId)}/runs`, { cache: "no-store" });
        if (!response.ok) return;
        const body = await response.json();
        const latest = ((body.data || []) as AgentRun[]).find(run => run.id === runtimeRun.id);
        if (active && latest) setRuntimeRun(latest);
      } catch { /* A later refresh can recover transient network errors. */ }
    };
    const timer = window.setInterval(() => { void refresh(); }, 10000);
    return () => { active = false; window.clearInterval(timer); };
  }, [agentId, runtimeRun?.id, runtimeRun?.status]);

  async function saveProfile() {
    setError("");
    try {
      const response = await fetch("/api/v1/me/persona", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName, tone, goal, memoryContextEnabled }),
      });
      if (response.status === 401) {
        localStorage.setItem("tan-agent-profile-v1", JSON.stringify({ displayName, tone, goal, memoryContextEnabled }));
        setProfileStorage("device");
        return;
      }
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "تعذر حفظ الهوية في الحساب.");
      setDisplayName(body.data.displayName);
      setTone(body.data.tone);
      setGoal(body.data.goal);
      setMemoryContextEnabled(Boolean(body.data.memoryContextEnabled));
      setProfileStorage("account");
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر حفظ الهوية.");
    }
  }

  async function runTask(value = task) {
    if (!value.trim() || busy) return;
    setBusy(true);
    setError("");
    setResponse(null);
    try {
      if (mode === "search") {
        if (accountState === "guest") throw new Error("سجّل الدخول أولاً لاستخدام الوكيل المرتبط بحسابك.");
        if (!agentId) throw new Error("لا يوجد وكيل شخصي نشط. افتح مساحة حسابك وأنشئ وفعّل وكيلاً أولاً.");
        const selectedGrant = grants.find(grant => grant.id === grantId);
        if (!selectedGrant) throw new Error("لا يوجد تفويض بحث نشط. افتح إعدادات الوكيل وأنشئ تفويضاً محدوداً للبحث في الويب.");
        if (!providerConsent) throw new Error("وافق أولاً على معالجة نص المهمة بواسطة مزود الذكاء الاصطناعي.");
        const res = await fetch(`/api/v1/agents/${encodeURIComponent(agentId)}/runs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            task: value,
            purpose: selectedGrant.purpose,
            target: "PUBLIC_WEB",
            grantId: selectedGrant.id,
            idempotencyKey: crypto.randomUUID(),
            providerConsent: true,
          }),
        });
        const body = await res.json();
        if (!res.ok) {
          if (res.status === 503) throw new Error("محرك الذكاء الاصطناعي أو العامل المجدول غير مهيأ على الخادم. لم تُرسل المهمة إلى OpenAI ولم تُحتسب تكلفة.");
          if (res.status === 401) throw new Error("انتهت جلسة الدخول. سجّل الدخول مجدداً.");
          if (res.status === 403) throw new Error("التفويض غير صالح أو لا يملك الوكيل صلاحية البحث المطلوبة.");
          throw new Error(body.error || "تعذر إضافة المهمة إلى قائمة الوكيل.");
        }
        setRuntimeRun(body.data as AgentRun);
        setResponse({ mode: "search", summary: "تم تسجيل المهمة في قائمة الوكيل. لم تُنفّذ بعد؛ ستظهر النتيجة عند اكتمال العامل الخلفي." });
      } else {
        const res = await fetch("/api/demo-agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode, task: value, profile: { displayName, tone, goal } }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "تعذر إعداد المسودة.");
        setResponse(body as AgentResponse);
      }
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
        <div className="agent-header-actions"><Link className="agent-login" href="/dashboard">مساحة حسابي</Link><Link className="agent-login" href="/sign-in">دخول الأعضاء</Link><span className="agent-status"><i /> معاينة الوكيل الشخصي</span></div>
      </header>

      <section className="agent-layout">
        <aside className="agent-sidebar">
          <div className="agent-profile-head"><div className="agent-avatar">✦</div><div><strong>{displayName || "وكيلك الشخصي"}</strong><small>يمثّل أهدافك وأسلوبك</small></div></div>
          <div className="agent-side-section">
            <span className="agent-overline">هويتك الرقمية</span>
            <label>اسم الوكيل<input value={displayName} onChange={e => setDisplayName(e.target.value)} maxLength={60} /></label>
            <label>أسلوب التواصل<select value={tone} onChange={e => setTone(e.target.value)}><option>واضح ومباشر</option><option>رسمي واحترافي</option><option>ودود ومقنع</option><option>تحليلي ودقيق</option></select></label>
            <label>هدفك الأساسي<textarea value={goal} onChange={e => setGoal(e.target.value)} rows={3} maxLength={240} /></label>
            <label className="agent-consent-check">
              <input type="checkbox" checked={memoryContextEnabled} onChange={e => setMemoryContextEnabled(e.target.checked)} />
              أسمح للوكيل باستخدام ذاكرتي الشخصية المؤكدة والاستنتاجات عالية الثقة عند إرسال المهام إلى مزود الذكاء الاصطناعي. لا تُرسل المعلومات الخاصة أو شديدة الحساسية، ويمكنني إيقاف ذلك في أي وقت.
            </label>
            <button className="agent-save" onClick={() => void saveProfile()} disabled={profileStorage === "checking"}>{profileStorage === "account" ? "حفظ الهوية في حسابك" : "حفظ الهوية"}</button>
            <small className="agent-local-note">{profileStorage === "account" ? "هويتك محفوظة في حسابك ويمكن استعادتها بعد تسجيل الدخول من جهاز آخر." : profileStorage === "device" ? "أنت تستخدم الوضع التجريبي؛ تُحفظ الهوية على هذا الجهاز فقط. سجّل الدخول لحفظها في حسابك." : profileStorage === "error" ? "تعذر التحقق من الحفظ السحابي. لن أدّعي أن الهوية حُفظت في حسابك." : "جارٍ التحقق من مكان حفظ هويتك..."}</small>
          </div>
          <MemoryManager />
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
            <textarea value={task} onChange={e => setTask(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void runTask(); } }} placeholder={mode === "search" ? "مثال: ابحث عن موزعي معدات الشبكات في السعودية، واجمع المواقع الرسمية..." : "اكتب تفاصيل المنتج أو الخدمة والجمهور الذي تريد الوصول إليه..."} rows={4} maxLength={mode === "search" ? 4000 : 1200} />
            {mode === "search" && (
              <div className="agent-runtime-consent">
                {accountState === "guest" ? <p>البحث عبر الوكيل الشخصي يتطلب تسجيل الدخول.</p> : null}
                {accountState === "ready" && agents.length === 0 ? <p>لا يوجد وكيل في حسابك بعد. أنشئ وكيلاً من <Link href="/dashboard/agents">مساحة الوكلاء</Link>.</p> : null}
                {agents.length > 0 && !agentId ? <p>لا يوجد وكيل نشط. فعّل وكيلاً من لوحة التحكم.</p> : null}
                {agentId && grants.length === 0 ? <p>لا يوجد تفويض بحث نشط لهذا الوكيل. أنشئ تفويضاً محدوداً من صفحة الوكيل.</p> : null}
                {agents.filter(agent => agent.status === "ACTIVE").length > 1 ? (
                  <label>الوكيل النشط
                    <select value={agentId} onChange={event => { setAgentId(event.target.value); setRuntimeRun(null); }}>
                      {agents.filter(agent => agent.status === "ACTIVE").map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                    </select>
                  </label>
                ) : null}
                {grants.length > 1 ? (
                  <label>تفويض البحث
                    <select value={grantId} onChange={event => setGrantId(event.target.value)}>
                      {grants.map(grant => <option key={grant.id} value={grant.id}>{grant.purpose}</option>)}
                    </select>
                  </label>
                ) : null}
                <label className="agent-consent-check">
                  <input type="checkbox" checked={providerConsent} onChange={event => setProviderConsent(event.target.checked)} />
                  أوافق على إرسال نص المهمة إلى مزود الذكاء الاصطناعي لمعالجتها والبحث في الويب. قد تُحفظ المهمة وخطتها لمدة تصل إلى 30 يوماً وفق إعدادات النظام وسياسة المزود. لن يُنفّذ الوكيل أي إجراء خارجي.
                </label>
              </div>
            )}
            <div className="agent-compose-bottom"><span>{mode === "search" ? `مهمة محفوظة في حسابك · ${task.length}/4000` : `مسودة محلية أولية · ${task.length}/1200`}</span><button onClick={() => void runTask()} disabled={busy || !task.trim()}>{busy ? "جارٍ العمل..." : "ابدأ المهمة"} <b>←</b></button></div>
          </div>

          {!response && !busy && <div className="agent-suggestions"><span>جرّب أن تطلب</span>{starterPrompts.map(p => <button key={p} onClick={() => { setMode(p.includes("إعلان") ? "ad" : "search"); setTask(p); }}>{p} <b>↗</b></button>)}</div>}
          {busy && <div className="agent-result-card agent-loading"><span className="agent-spinner" /> أعمل على طلبك الآن...</div>}
          {error && <div className="agent-error" role="alert">{error}</div>}
          {runtimeRun && mode === "search" && <section className="agent-result-card" aria-live="polite">
            <div className="agent-result-heading"><span className="agent-overline">حالة مهمة الوكيل</span><span className="agent-result-tag">{runtimeRun.status}</span></div>
            <h2>{runtimeRun.status === "PLANNED" ? "أعد الوكيل خطة بحث أولية" : runtimeRun.status === "QUEUED" ? "المهمة في قائمة الانتظار" : runtimeRun.status === "PLANNING" ? "العامل يعالج المهمة" : runtimeRun.status === "FAILED" || runtimeRun.status === "DEAD_LETTER" ? "تعذر إكمال المهمة" : runtimeRun.status === "CANCELLED" ? "أُلغيت المهمة" : "حالة المهمة"}</h2>
            {runtimeRun.planSummary ? <p>{runtimeRun.planSummary}</p> : null}
            {runtimeRun.steps?.length ? <div className="agent-search-results">{runtimeRun.steps.map((step, index) => <article key={step.stepId}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{step.action}</strong><p>{step.description}</p><small>{step.status}</small></div></article>)}</div> : null}
            {runtimeRun.planSources?.length ? <div className="agent-search-results">{runtimeRun.planSources.map(source => <article key={source.url}><span>↗</span><div><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a><small>{new URL(source.url).hostname} · مصدر أرجعه بحث الويب</small>{source.evidence?.map((item, index) => <p key={index}>ادعاء مرتبط بالمصدر: {item.claim}</p>)}</div></article>)}</div> : null}
            {runtimeRun.errorCode ? <p role="status">رمز الحالة: {runtimeRun.errorCode}</p> : null}
            <p className="agent-disclaimer">هذه خطة مقترحة. الادعاءات مرتبطة بروابط أعادها بحث الويب، لكنها لم تخضع بعد لفحص مستقل لمحتوى الصفحات أو صحة المعلومات. لا ينفذ الوكيل إجراءات خارجية.</p>
          </section>}
          {response && <section className="agent-result-card" aria-live="polite">
            <div className="agent-result-heading"><span className="agent-overline">نتيجة المهمة</span><span className="agent-result-tag">{response.mode === "search" ? "بحث ويب" : "مسودة إعلان"}</span></div>
            <h2>{response.summary}</h2>
            {response.results?.length ? <div className="agent-search-results">{response.results.map((r, i) => <article key={r.url}><span>{String(i + 1).padStart(2, "0")}</span><div><a href={r.url} target="_blank" rel="noreferrer">{r.title} ↗</a><p>{r.snippet}</p><small>{new URL(r.url).hostname}</small></div></article>)}</div> : null}
            {response.results?.length === 0 ? <p>لم أجد نتائج قابلة للاستخراج لهذا الاستعلام. جرّب صياغة أكثر تحديداً.</p> : null}
            {response.draft ? <div className="agent-ad-draft"><pre>{response.draft}</pre><button onClick={() => void navigator.clipboard.writeText(response.draft || "")}>نسخ المسودة</button></div> : null}
            {response.mode === "ad" ? <p className="agent-disclaimer">تنبيه الشفافية: هذه مسودة قالب أولية محلية، وليست نصاً مولداً بواسطة نموذج OpenAI.</p> : null}
          </section>}
          <footer className="agent-footer">THE AGENT NETWORK <span>نسخة تجريبية أولية · لا تمثل اعتماداً أو شراكة مع OpenAI</span></footer>
        </section>
      </section>
    </main>
  );
}
