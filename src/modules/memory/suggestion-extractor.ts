import { createHash } from "node:crypto";

export type MemorySuggestionDraft = {
  content: string;
  evidenceExcerpt: string;
  confidence: number;
  dedupeKey: string;
};

/**
 * Conservative deterministic extraction. Only explicit, low-risk response-style
 * preferences are eligible. No LLM is called and no sensitive trait is inferred.
 */
export function extractExplicitMemorySuggestions(task: string): MemorySuggestionDraft[] {
  const normalized = task.replace(/\s+/g, " ").trim().slice(0, 4000);
  const patterns: Array<{ regex: RegExp; toContent: (match: RegExpMatchArray) => string }> = [
    {
      regex: /(?:أنا\s*)?(?:أفضل|افضل|أفضّل)\s+(?:أن\s+)?(?:تكون\s+)?(الردود\s+المختصرة|الشرح\s+المباشر|الشرح\s+خطوة\s+بخطوة|اللغة\s+العربية)/iu,
      toContent: (match) => "يفضل المستخدم " + match[1],
    },
    {
      regex: /\bI prefer (concise|brief|direct|step-by-step) (answers|responses|explanations)\b/iu,
      toContent: (match) => "The owner prefers " + match[1] + " " + match[2] + ".",
    },
    {
      regex: /\bI prefer (Arabic|English) responses\b/iu,
      toContent: (match) => "The owner prefers " + match[1] + " responses.",
    },
  ];
  const suggestions: MemorySuggestionDraft[] = [];
  for (const pattern of patterns) {
    const match = normalized.match(pattern.regex);
    if (!match) continue;
    const evidenceExcerpt = match[0].slice(0, 500);
    const content = pattern.toContent(match).trim().slice(0, 1000);
    const dedupeKey = createHash("sha256").update(content.toLocaleLowerCase()).digest("hex");
    suggestions.push({ content, evidenceExcerpt, confidence: 0.9, dedupeKey });
    if (suggestions.length >= 2) break;
  }
  return suggestions;
}
