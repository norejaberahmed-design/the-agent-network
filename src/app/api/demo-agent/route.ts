import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Mode = "search" | "ad";
type Profile = { displayName?: string; tone?: string; goal?: string };

function cleanText(value: string) {
  return value.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ").trim();
}

function parseResults(html: string) {
  const items: Array<{ title: string; url: string; snippet: string }> = [];
  const blocks = html.split(/class="result(?:\s|")/).slice(1);
  for (const block of blocks) {
    const link = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    let url = link[1];
    try {
      if (url.startsWith("//")) url = "https:" + url;
      const parsed = new URL(url);
      const redirected = parsed.searchParams.get("uddg");
      if (redirected) url = redirected;
      const safe = new URL(url);
      if (!["https:", "http:"].includes(safe.protocol) || safe.username || safe.password) continue;
      const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/[^>]+>/i);
      items.push({ title: cleanText(link[2]).slice(0, 240), url: safe.toString(), snippet: snippetMatch ? cleanText(snippetMatch[1]).slice(0, 600) : "" });
      if (items.length >= 7) break;
    } catch { /* Ignore malformed result URLs. */ }
  }
  return items;
}

function adDraft(task: string, profile: Profile) {
  const tone = profile.tone || "واضح ومباشر";
  const title = task.split(/[.\n،؛]/)[0].trim().slice(0, 90) || "منتجك أو خدمتك";
  return [
    title,
    "",
    task.trim(),
    "",
    "لماذا تهتم؟",
    "• تفاصيل واضحة عن المنتج أو الخدمة.",
    "• تواصل مباشر لمعرفة التوفر والمواصفات.",
    "",
    "للاستفسار وطلب التفاصيل، تواصل معنا.",
    "",
    "ملاحظة تحريرية: أضف السعر والمواصفات والضمان ومكان التسليم قبل النشر. لا تنشر أي ادعاء غير موثق.",
    "نبرة الصياغة المطلوبة: " + tone,
  ].join("\n");
}

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "صيغة الطلب غير صحيحة." }, { status: 400 }); }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "الطلب غير صالح." }, { status: 400 });
  const data = body as { mode?: unknown; task?: unknown; profile?: Profile };
  if (data.mode !== "search" && data.mode !== "ad") return NextResponse.json({ error: "نوع المهمة غير مدعوم." }, { status: 400 });
  if (typeof data.task !== "string" || !data.task.trim() || data.task.length > 1200) return NextResponse.json({ error: "اكتب طلباً من 1 إلى 1200 حرف." }, { status: 422 });
  const task = data.task.trim();
  const profile = data.profile && typeof data.profile === "object" ? data.profile : {};

  if (data.mode === "ad") {
    return NextResponse.json({ mode: "ad", summary: "أعددت مسودة أولية بناءً على وصفك.", draft: adDraft(task, profile) }, { headers: { "Cache-Control": "no-store" } });
  }

  try {
    const endpoint = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(task);
    const upstream = await fetch(endpoint, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TheAgentNetworkPreview/0.1)" },
      signal: AbortSignal.timeout(12000),
      cache: "no-store",
    });
    if (!upstream.ok) return NextResponse.json({ error: "محرك البحث الخارجي غير متاح الآن. حاول لاحقاً." }, { status: 502 });
    const html = await upstream.text();
    const results = parseResults(html);
    return NextResponse.json({
      mode: "search",
      summary: results.length ? "وجدت نتائج عامة مرتبطة بطلبك. افتح المصادر للتحقق من التفاصيل." : "لم أتمكن من استخراج نتائج لهذا الطلب.",
      results,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "تعذر الوصول إلى محرك البحث الآن." }, { status: 502 });
  }
}
