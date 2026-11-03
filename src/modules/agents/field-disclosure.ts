export type AgentDisclosureFieldKey = "name" | "publicDescription" | "purpose";
export type AgentDisclosureClassification =
  | "PUBLIC"
  | "CONTEXTUAL"
  | "PRIVATE"
  | "HIGHLY_SENSITIVE";

export type AgentDisclosurePolicy = {
  fieldKey: AgentDisclosureFieldKey;
  classification: AgentDisclosureClassification;
  publicVisible: boolean;
  allowedPurposes: string[];
  allowedAudiences: string[];
};

export type AgentDisclosureContext = {
  purpose: string;
  audience: string;
  /**
   * This must be derived server-side from a fresh, exact, auditable owner
   * approval and a currently valid grant. Never accept it from a client or
   * model-generated payload.
   */
  ownerApproved: boolean;
};

export type AgentDisclosureDecision = {
  fieldKey: AgentDisclosureFieldKey;
  included: boolean;
  reason:
    | "INCLUDED_PUBLIC"
    | "INCLUDED_OWNER_APPROVED"
    | "POLICY_MISSING"
    | "POLICY_AMBIGUOUS"
    | "INVALID_PUBLIC_VISIBILITY"
    | "NOT_PUBLIC"
    | "OWNER_APPROVAL_REQUIRED"
    | "PURPOSE_NOT_ALLOWED"
    | "AUDIENCE_NOT_ALLOWED"
    | "HIGHLY_SENSITIVE_DENIED"
    | "VALUE_UNAVAILABLE";
};

export type AgentDisclosureSource = {
  id: string;
  name: string;
  publicDescription: string | null;
  purpose: string;
};

export type AgentDisclosureProjection = {
  id: string;
  profile: Partial<Record<AgentDisclosureFieldKey, string>>;
  decisions: AgentDisclosureDecision[];
};

/**
 * Fail-closed outbound profile projection.
 *
 * This is a policy primitive, not an execution or approval service. The
 * caller must authenticate the actor, verify the grant and recipient, and
 * derive ownerApproved from a fresh approval bound to this exact request.
 * Missing or ambiguous policy records never disclose a field.
 */
export function projectAgentDisclosure(
  agent: AgentDisclosureSource,
  policies: AgentDisclosurePolicy[],
  context: AgentDisclosureContext,
): AgentDisclosureProjection {
  const values: Record<AgentDisclosureFieldKey, string | null> = {
    name: agent.name,
    publicDescription: agent.publicDescription,
    purpose: agent.purpose,
  };
  const profile: Partial<Record<AgentDisclosureFieldKey, string>> = {};
  const decisions: AgentDisclosureDecision[] = [];

  for (const fieldKey of ["name", "publicDescription", "purpose"] as const) {
    const matchingPolicies = policies.filter((policy) => policy.fieldKey === fieldKey);
    if (matchingPolicies.length === 0) {
      decisions.push({ fieldKey, included: false, reason: "POLICY_MISSING" });
      continue;
    }
    if (matchingPolicies.length !== 1) {
      decisions.push({ fieldKey, included: false, reason: "POLICY_AMBIGUOUS" });
      continue;
    }

    const policy = matchingPolicies[0];
    if (policy.publicVisible && policy.classification !== "PUBLIC") {
      decisions.push({ fieldKey, included: false, reason: "INVALID_PUBLIC_VISIBILITY" });
      continue;
    }
    if (policy.classification === "HIGHLY_SENSITIVE") {
      decisions.push({ fieldKey, included: false, reason: "HIGHLY_SENSITIVE_DENIED" });
      continue;
    }
    if (policy.classification === "PUBLIC") {
      if (!policy.publicVisible) {
        decisions.push({ fieldKey, included: false, reason: "NOT_PUBLIC" });
        continue;
      }
      if (
        policy.allowedPurposes.length > 0 &&
        !policy.allowedPurposes.includes(context.purpose)
      ) {
        decisions.push({ fieldKey, included: false, reason: "PURPOSE_NOT_ALLOWED" });
        continue;
      }
      if (
        policy.allowedAudiences.length > 0 &&
        !policy.allowedAudiences.includes(context.audience)
      ) {
        decisions.push({ fieldKey, included: false, reason: "AUDIENCE_NOT_ALLOWED" });
        continue;
      }
      const value = values[fieldKey];
      if (value === null) {
        decisions.push({ fieldKey, included: false, reason: "VALUE_UNAVAILABLE" });
        continue;
      }
      profile[fieldKey] = value;
      decisions.push({ fieldKey, included: true, reason: "INCLUDED_PUBLIC" });
      continue;
    }

    if (!context.ownerApproved) {
      decisions.push({ fieldKey, included: false, reason: "OWNER_APPROVAL_REQUIRED" });
      continue;
    }
    if (
      policy.allowedPurposes.length === 0 ||
      !policy.allowedPurposes.includes(context.purpose)
    ) {
      decisions.push({ fieldKey, included: false, reason: "PURPOSE_NOT_ALLOWED" });
      continue;
    }
    if (
      policy.allowedAudiences.length === 0 ||
      !policy.allowedAudiences.includes(context.audience)
    ) {
      decisions.push({ fieldKey, included: false, reason: "AUDIENCE_NOT_ALLOWED" });
      continue;
    }

    const value = values[fieldKey];
    if (value === null) {
      decisions.push({ fieldKey, included: false, reason: "VALUE_UNAVAILABLE" });
      continue;
    }
    profile[fieldKey] = value;
    decisions.push({
      fieldKey,
      included: true,
      reason: "INCLUDED_OWNER_APPROVED",
    });
  }

  return { id: agent.id, profile, decisions };
}
