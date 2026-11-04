import { z } from "zod";

const agentPlanActionSchema = z.enum([
  "READ_PUBLIC_PROFILE",
  "SEARCH_PUBLIC_WEB",
  "DRAFT_MESSAGE",
  "ASK_OWNER",
]);

/**
 * The planner may propose work, but it never executes tools or external actions.
 * Capability names are server-derived from the agent's persisted configuration.
 */
export const agentPlanStepSchema = z.object({
  id: z.string().trim().min(1).max(64),
  action: agentPlanActionSchema,
  description: z.string().trim().min(1).max(500),
  input: z.record(
    z.string().trim().min(1).max(64),
    z.union([z.string().max(1000), z.number().finite(), z.boolean()]),
  ).refine((value) => Object.keys(value).length <= 12, "Too many input fields"),
}).strict();

const agentPlanSourceSchema = z.object({
  url: z.string().url().max(2048).refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "https:" || protocol === "http:";
  }),
  title: z.string().trim().min(1).max(300),
}).strict();

const agentPlanEvidenceSchema = z.object({
  claim: z.string().trim().min(1).max(500),
  sourceUrl: z.string().url().max(2048).refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "https:" || protocol === "http:";
  }),
}).strict();

export const agentPlanSchema = z.object({
  summary: z.string().trim().min(1).max(1000),
  steps: z.array(agentPlanStepSchema).min(1).max(8),
  sources: z.array(agentPlanSourceSchema).max(10).default([]),
  evidence: z.array(agentPlanEvidenceSchema).max(20).default([]),
}).strict().superRefine((plan, ctx) => {
  const sourceUrls = new Set(plan.sources.map((source) => source.url));
  plan.evidence.forEach((evidence, index) => {
    if (!sourceUrls.has(evidence.sourceUrl)) {
      ctx.addIssue({
        code: "custom",
        path: ["evidence", index, "sourceUrl"],
        message: "Evidence must reference a source returned by the web search provider",
      });
    }
  });
  const ids = new Set<string>();
  plan.steps.forEach((step, index) => {
    if (ids.has(step.id)) {
      ctx.addIssue({
        code: "custom",
        path: ["steps", index, "id"],
        message: "Step identifiers must be unique",
      });
    }
    ids.add(step.id);
  });
});

export type AgentPlan = z.infer<typeof agentPlanSchema>;
export type AgentPlanAction = z.infer<typeof agentPlanActionSchema>;

export type AgentPlanningRequest = {
  task: string;
  trustedContext: {
    agentName: string;
    agentPurpose: string;
    allowedActions: AgentPlanAction[];
    persona?: { displayName: string; tone: string; goal: string };
  };
  /** External pages, documents, and messages are data, never policy instructions. */
  untrustedSources: Array<{
    sourceId: string;
    content: string;
  }>;
  safetyIdentifier?: string;
};

const agentPlanningRequestSchema = z.object({
  task: z.string().trim().min(1).max(4000),
  trustedContext: z.object({
    agentName: z.string().trim().min(1).max(120),
    agentPurpose: z.string().trim().min(1).max(1000),
    persona: z.object({
      displayName: z.string().trim().min(1).max(60),
      tone: z.string().trim().min(1).max(40),
      goal: z.string().trim().min(1).max(240),
    }).strict().optional(),
    allowedActions: z.array(agentPlanActionSchema).max(4).refine(
      (actions) => new Set(actions).size === actions.length,
      "Allowed actions must be unique",
    ),
  }).strict(),
  safetyIdentifier: z.string().trim().min(16).max(128).optional(),
  untrustedSources: z.array(z.object({
    sourceId: z.string().trim().min(1).max(120),
    content: z.string().min(1).max(8000),
  }).strict()).max(10).superRefine((sources, ctx) => {
    const ids = new Set<string>();
    sources.forEach((source, index) => {
      if (ids.has(source.sourceId)) {
        ctx.addIssue({
          code: "custom",
          path: [index, "sourceId"],
          message: "Source identifiers must be unique",
        });
      }
      ids.add(source.sourceId);
    });
  }),
}).strict();

export class AgentPlanProviderError extends Error {
  constructor(
    readonly code: "PROVIDER_RATE_LIMITED" | "PROVIDER_UNAVAILABLE" | "PROVIDER_CONFIGURATION_ERROR" | "PROVIDER_REJECTED" | "PROVIDER_POLICY_BLOCKED" | "PROVIDER_TIMEOUT" | "PROVIDER_INVALID_RESPONSE",
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "AgentPlanProviderError";
  }
}

export type AgentPlanProvider = {
  generatePlan(request: AgentPlanningRequest): Promise<unknown>;
};

export type AgentPlanResult =
  | { status: "PLANNED"; plan: AgentPlan }
  | { status: "INVALID_PLAN"; reason: "SCHEMA_INVALID" | "UNAUTHORIZED_ACTION" | "UNVERIFIED_SOURCE" }
  | { status: "PROVIDER_ERROR"; code: AgentPlanProviderError["code"]; retryable: boolean }
  | { status: "PROVIDER_ERROR"; code: "PROVIDER_UNKNOWN"; retryable: true };

/**
 * Validates untrusted request data and model output against a server-derived
 * capability allowlist. This is a planning boundary only: no network, tool,
 * message, or database action is performed here.
 */
export async function createAgentPlan(
  provider: AgentPlanProvider,
  request: AgentPlanningRequest,
): Promise<AgentPlanResult> {
  const validatedRequest = agentPlanningRequestSchema.safeParse(request);
  if (!validatedRequest.success) {
    return { status: "INVALID_PLAN", reason: "SCHEMA_INVALID" };
  }

  const trustedRequest = validatedRequest.data;
  let generated: unknown;
  try {
    generated = await provider.generatePlan(trustedRequest);
  } catch (error) {
    // Expose only a bounded classification, never provider payloads or credentials.
    if (error instanceof AgentPlanProviderError) {
      return { status: "PROVIDER_ERROR", code: error.code, retryable: error.retryable };
    }
    return { status: "PROVIDER_ERROR", code: "PROVIDER_UNKNOWN", retryable: true };
  }

  const parsed = agentPlanSchema.safeParse(generated);
  if (!parsed.success) {
    const hasUnverifiedSource = parsed.error.issues.some((issue) =>
      issue.path[0] === "evidence" && issue.path[1] !== undefined
    );
    return { status: "INVALID_PLAN", reason: hasUnverifiedSource ? "UNVERIFIED_SOURCE" : "SCHEMA_INVALID" };
  }

  const allowed = new Set(trustedRequest.trustedContext.allowedActions);
  if (parsed.data.steps.some((step) => !allowed.has(step.action))) {
    return { status: "INVALID_PLAN", reason: "UNAUTHORIZED_ACTION" };
  }

  return { status: "PLANNED", plan: parsed.data };
}
