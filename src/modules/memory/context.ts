import type { DataClassification, PersonalMemoryKind } from "@prisma/client";

export type PersonalMemoryContextItem = {
  id: string;
  kind: PersonalMemoryKind;
  content: string;
  purpose: string;
  classification: DataClassification;
  confidence: number | null;
  sourceType: string;
  sourceReference: string | null;
  expiresAt: Date | null;
  taskContextRunId: string | null;
  status?: "ACTIVE" | "ARCHIVED" | "DELETED";
};

export type PersonalContextOptions = {
  now?: Date;
  runId?: string;
  maxItems?: number;
  allowPrivate?: boolean;
};

export function selectPersonalContext<T extends PersonalMemoryContextItem>(
  memories: T[],
  options: PersonalContextOptions = {},
): T[] {
  const now = options.now ?? new Date();
  const maxItems = Math.min(Math.max(options.maxItems ?? 20, 1), 50);
  return memories
    .filter((memory) => {
      if (memory.classification === "HIGHLY_SENSITIVE") return false;
      if (memory.classification === "PRIVATE" && options.allowPrivate !== true) return false;
      if (memory.status && memory.status !== "ACTIVE") return false;
      if (memory.expiresAt && memory.expiresAt <= now) return false;
      if (memory.kind === "CONFIRMED") return true;
      if (memory.kind === "INFERRED") {
        return memory.confidence !== null && memory.confidence >= 0.8;
      }
      return memory.kind === "TASK_CONTEXT" &&
        Boolean(options.runId) &&
        memory.taskContextRunId === options.runId;
    })
    .sort((a, b) => {
      const priority = (kind: PersonalMemoryKind) =>
        kind === "CONFIRMED" ? 0 : kind === "INFERRED" ? 1 : 2;
      return priority(a.kind) - priority(b.kind);
    })
    .slice(0, maxItems);
}
