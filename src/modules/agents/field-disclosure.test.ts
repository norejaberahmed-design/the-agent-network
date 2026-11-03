import { describe, expect, it } from "vitest";
import {
  projectAgentDisclosure,
  type AgentDisclosurePolicy,
} from "./field-disclosure";

const agent = {
  id: "agent-1",
  name: "Procurement Agent",
  publicDescription: "Finds approved suppliers.",
  purpose: "Internal procurement strategy and target pricing.",
};

const publicPolicy: AgentDisclosurePolicy = {
  fieldKey: "name",
  classification: "PUBLIC",
  publicVisible: true,
  allowedPurposes: [],
  allowedAudiences: [],
};

const contextualPolicy: AgentDisclosurePolicy = {
  fieldKey: "publicDescription",
  classification: "CONTEXTUAL",
  publicVisible: false,
  allowedPurposes: ["supplier-introduction"],
  allowedAudiences: ["verified-supplier"],
};

const privatePolicy: AgentDisclosurePolicy = {
  fieldKey: "purpose",
  classification: "PRIVATE",
  publicVisible: false,
  allowedPurposes: ["internal-procurement-review"],
  allowedAudiences: ["procurement-team"],
};

const context = {
  purpose: "supplier-introduction",
  audience: "verified-supplier",
  ownerApproved: false,
};

describe("agent field disclosure projection", () => {
  it("fails closed when a field policy is missing", () => {
    const result = projectAgentDisclosure(agent, [], context);
    expect(result.profile).toEqual({});
    expect(result.decisions.every((decision) => !decision.included)).toBe(true);
    expect(result.decisions.every((decision) => decision.reason === "POLICY_MISSING")).toBe(true);
  });

  it("includes only explicitly public fields", () => {
    const result = projectAgentDisclosure(agent, [publicPolicy], context);
    expect(result.profile).toEqual({ name: "Procurement Agent" });
    expect(result.decisions.find((decision) => decision.fieldKey === "name")?.reason)
      .toBe("INCLUDED_PUBLIC");
  });

  it("does not disclose a PUBLIC field when publicVisible is false", () => {
    const result = projectAgentDisclosure(
      agent,
      [{ ...publicPolicy, publicVisible: false }],
      context,
    );
    expect(result.profile).not.toHaveProperty("name");
    expect(result.decisions[0].reason).toBe("NOT_PUBLIC");
  });

  it("enforces purpose and audience restrictions on public fields", () => {
    const restricted = {
      ...publicPolicy,
      allowedPurposes: ["supplier-introduction"],
      allowedAudiences: ["verified-supplier"],
    };
    const wrongPurpose = projectAgentDisclosure(agent, [restricted], {
      ...context,
      purpose: "marketing",
    });
    const wrongAudience = projectAgentDisclosure(agent, [restricted], {
      ...context,
      audience: "unknown-recipient",
    });
    expect(wrongPurpose.profile).toEqual({});
    expect(wrongPurpose.decisions[0].reason).toBe("PURPOSE_NOT_ALLOWED");
    expect(wrongAudience.profile).toEqual({});
    expect(wrongAudience.decisions[0].reason).toBe("AUDIENCE_NOT_ALLOWED");
  });

  it("requires owner approval and exact purpose/audience for contextual disclosure", () => {
    const withoutApproval = projectAgentDisclosure(agent, [contextualPolicy], context);
    expect(withoutApproval.profile).toEqual({});
    expect(withoutApproval.decisions[1].reason).toBe("OWNER_APPROVAL_REQUIRED");

    const approved = projectAgentDisclosure(agent, [contextualPolicy], {
      ...context,
      ownerApproved: true,
    });
    expect(approved.profile).toEqual({
      publicDescription: "Finds approved suppliers.",
    });
    expect(approved.decisions[1].reason).toBe("INCLUDED_OWNER_APPROVED");
  });

  it("requires both allow-lists for owner-approved private disclosure", () => {
    const missingPurpose = projectAgentDisclosure(
      agent,
      [{ ...privatePolicy, allowedPurposes: [] }],
      {
        purpose: "internal-procurement-review",
        audience: "procurement-team",
        ownerApproved: true,
      },
    );
    const wrongAudience = projectAgentDisclosure(agent, [privatePolicy], {
      purpose: "internal-procurement-review",
      audience: "external-supplier",
      ownerApproved: true,
    });
    expect(missingPurpose.profile).toEqual({});
    expect(missingPurpose.decisions[2].reason).toBe("PURPOSE_NOT_ALLOWED");
    expect(wrongAudience.profile).toEqual({});
    expect(wrongAudience.decisions[2].reason).toBe("AUDIENCE_NOT_ALLOWED");
  });

  it("never discloses HIGHLY_SENSITIVE fields, even with owner approval", () => {
    const result = projectAgentDisclosure(
      agent,
      [{
        ...privatePolicy,
        classification: "HIGHLY_SENSITIVE",
        allowedPurposes: ["internal-procurement-review"],
        allowedAudiences: ["procurement-team"],
      }],
      {
        purpose: "internal-procurement-review",
        audience: "procurement-team",
        ownerApproved: true,
      },
    );
    expect(result.profile).toEqual({});
    expect(result.decisions[2].reason).toBe("HIGHLY_SENSITIVE_DENIED");
  });

  it("rejects invalid non-public policies marked publicVisible", () => {
    const result = projectAgentDisclosure(
      agent,
      [{ ...contextualPolicy, publicVisible: true }],
      { ...context, ownerApproved: true },
    );
    expect(result.profile).toEqual({});
    expect(result.decisions[1].reason).toBe("INVALID_PUBLIC_VISIBILITY");
  });

  it("fails closed when duplicate policy records are supplied", () => {
    const result = projectAgentDisclosure(
      agent,
      [publicPolicy, publicPolicy],
      context,
    );
    expect(result.profile).toEqual({});
    expect(result.decisions[0].reason).toBe("POLICY_AMBIGUOUS");
  });
  it("does not claim to include a public field when its value is absent", () => {
    const result = projectAgentDisclosure(
      { ...agent, publicDescription: null },
      [{ ...publicPolicy, fieldKey: "publicDescription" }],
      context,
    );
    expect(result.profile).toEqual({});
    expect(result.decisions[1]).toMatchObject({
      fieldKey: "publicDescription",
      included: false,
      reason: "VALUE_UNAVAILABLE",
    });
  });

});
