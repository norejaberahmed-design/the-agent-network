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
  url: z.string().url().max(2048),
  title: z.string().trim().min(1).max(300),
}).strict();

export const agentPlanSchema = z.object({
  summary: z.string().trim().min(1).max(1000),
  steps: z.array(agentPlanStepSchema).min(1).max(8),
  sources: z.array(agentPlanSourceSchema).max(10).default([]),
}).strict().superRefine((plan, ctx) => {
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
  };
  /** External pages, documents, and messages are data, never policy instructions. */
  untrustedSources: Array<{
    sourceId: string;
    content: string;
  }>;
};

const agentPlanningRequestSchema = z.object({
  task: z.string().trim().min(1).max(4000),
  trustedContext: z.object({
    agentName: z.string().trim().min(1).max(120),
    agentPurpose: z.string().trim().min(1).max(1000),
    allowedActions: z.array(agentPlanActionSchema).max(4).refine(
      (actions) => new Set(actions).size === actions.length,
      "Allowed actions must be unique",
    ),
  }).strict(),
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

export type AgentPlanProvider = {
  generatePlan(request: AgentPlanningRequest): Promise<unknown>;
};

export type AgentPlanResult =
  | { status: "PLANNED"; plan: AgentPlan }
  | { status: "INVALID_PLAN"; reason: "SCHEMA_INVALID" | "UNAUTHORIZED_ACTION" }
  | { status: "PROVIDER_ERROR" };

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
  } catch {
    // Do not leak provider exceptions, credentials, or internal request details.
    return { status: "PROVIDER_ERROR" };
  }

  const parsed = agentPlanSchema.safeParse(generated);
  if (!parsed.success) {
    return { status: "INVALID_PLAN", reason: "SCHEMA_INVALID" };
  }

  const allowed = new Set(trustedRequest.trustedContext.allowedActions);
  if (parsed.data.steps.some((step) => !allowed.has(step.action))) {
    return { status: "INVALID_PLAN", reason: "UNAUTHORIZED_ACTION" };
  }

  return { status: "PLANNED", plan: parsed.data };
}
