import { randomUUID } from "node:crypto";\nimport type { Prisma } from "@prisma/client";
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
  if (input.content.trim().length < 2 || input.purpose.trim().length < 3 || !input.sourceReference.trim()) {\n    throw new Error("INVALID_MEMORY_INPUT");\n  }\n  if (!Number.isFinite(input.confidence) || input.confidence < 0.01 || input.confidence > 0.99) {
    throw new Error("INVALID_MEMORY_CONFIDENCE");
  }
  if (input.expiresAt <= new Date()) throw new Error("INVALID_MEMORY_EXPIRY");

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
