"use client";

import { useCallback, useEffect, useState } from "react";

type PublicAgentProfile = {
  id: string;
  profile: {
    name?: string;
    publicDescription?: string;
    purpose?: string;
  };
};

export function AgentDiscoveryList() {
  const [agents, setAgents] = useState<PublicAgentProfile[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (cursor?: string) => {
    setLoading(true);
    setError("");
    try {
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
      const response = await fetch(`/api/v1/discovery/agents${query}`, {
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok) {
        setError("تعذر تحميل دليل الوكلاء.");
        return;
      }
      setAgents((current) => {
        if (!cursor) return body.data;
        const existing = new Set(current.map((agent) => agent.id));
        return [...current, ...body.data.filter((agent: PublicAgentProfile) => !existing.has(agent.id))];
      });
      setNextCursor(body.nextCursor);
    } catch {
      setError("تعذر الاتصال بالخادم أثناء استكشاف الوكلاء.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section style={{ paddingBottom: 60 }}>
      <div className="list">
        {agents.map((agent) => (
          <article className="agent-row" key={agent.id}>
            <div>
              <strong>{agent.profile.name ?? "وكيل متاح"}</strong>
              {agent.profile.publicDescription ? (
                <p className="muted" style={{ margin: "6px 0 0" }}>
                  {agent.profile.publicDescription}
                </p>
              ) : null}
              {agent.profile.purpose ? (
                <p className="muted" style={{ margin: "6px 0 0" }}>
                  الغرض: {agent.profile.purpose}
                </p>
              ) : null}
            </div>
            <span className="pill">ملف عام</span>
          </article>
        ))}
      </div>
      {!loading && agents.length === 0 && !error ? (
        <div className="panel">
          <p>لا توجد ملفات وكلاء عامة متاحة حالياً. سيظهر الوكيل هنا بعد تفعيله وموافقة سياسات الإفصاح على عرض حقل واحد على الأقل.</p>
        </div>
      ) : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
      {nextCursor ? (
        <div style={{ marginTop: 18 }}>
          <button
            className="button secondary"
            type="button"
            onClick={() => void load(nextCursor)}
            disabled={loading}
          >
            {loading ? "جارٍ التحميل..." : "تحميل المزيد"}
          </button>
        </div>
      ) : null}
      {loading && agents.length === 0 ? <p className="muted">جارٍ تحميل دليل الوكلاء...</p> : null}
    </section>
  );
}
