import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type InferredMemoryInput = {
  userId: string;
  content: string;
  sourceReference: string;
  purpose: string;
  confidence: number;
  expiresAt: Date;
};

export async function createInferredMemory(input: InferredMemoryInput) {
  if (input.content.trim().length < 2 || input.purpose.trim().length < 3 || !input.sourceReference.trim()) {
    throw new Error("INVALID_MEMORY_INPUT");
  }
  if (!Number.isFinite(input.confidence) || input.confidence < 0.01 || input.confidence > 0.99) {
    throw new Error("INVALID_MEMORY_CONFIDENCE");
  }
  const now = new Date();\n  if (input.expiresAt <= now || input.expiresAt.getTime() > now.getTime() + 90 * 24 * 60 * 60 * 1000) {\n    throw new Error("INVALID_MEMORY_EXPIRY");\n  }

  const correlationId = randomUUID();
  return prisma.$transaction(async (tx) => {
    const memory = await tx.personalMemory.create({
      data: {
        userId: input.userId,
        kind: "INFERRED",
        content: input.content.trim().slice(0, 2000),
        sourceType: "OBSERVED_PATTERN",
        sourceReference: input.sourceReference.slice(0, 300),
        confidence: input.confidence,
        classification: "CONTEXTUAL",
        purpose: input.purpose.slice(0, 240),
        lastObservedAt: new Date(),
        expiresAt: input.expiresAt,
      } satisfies Prisma.PersonalMemoryUncheckedCreateInput,
    });
    await tx.auditEvent.create({
      data: {
        ownerType: "USER",
        ownerId: input.userId,
        action: "personal_memory.inferred",
        targetType: "PersonalMemory",
        targetId: memory.id,
        outcome: "COMPLETED",
        correlationId,
        metadata: { kind: memory.kind, confidenceBand: memory.confidence !== null && memory.confidence >= 0.8 ? "HIGH" : "LOW" },
      },
    });
    return memory;
  });
}
