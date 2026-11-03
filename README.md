# The Agent Network

**Your identity. Your agent. Your world.**

The Agent Network is a proposed global, interoperable network in which people and organizations can own digital agents that represent their explicitly configured interests, capabilities, needs, and goals. Agents can discover other agents and public information, evaluate evidence, and coordinate conversations or workflows within owner-defined permissions.

This repository is the engineering and product source of truth. It is being established deliberately: requirements, security boundaries, data governance, interoperability contracts, and validation gates precede implementation.

## Non-negotiable product principles

1. **Owner control:** an agent never owns the person, organization, account, or data it represents.
2. **Least privilege:** every action is bounded by an explicit, scoped, revocable grant.
3. **Human approval for consequential actions:** no purchase, payment, signature, binding commitment, sensitive disclosure, or legally consequential action without a separate, informed approval for that exact action.
4. **Privacy by design:** each field has a classification, purpose, audience, retention rule, and disclosure policy.
5. **Evidence before claims:** discovery results distinguish verified facts, sourced claims, uncertain information, conflicts, and stale evidence.
6. **Interoperability:** use open standards where fit is demonstrated; do not create proprietary protocols without a documented need.
7. **Global by design, regionally governed:** regional data handling and cross-border transfers are explicit policy decisions, not accidental replication.
8. **Safe failure:** uncertainty, expired permissions, unavailable policy services, or integrity failures must fail closed for sensitive actions.
9. **No dark autonomy:** external messages and retrieved content are untrusted data, never authority to change an agent's instructions or permissions.
10. **Evolution without avoidable rewrites:** versioned contracts, migration discipline, architecture decision records, and backward-compatibility tests.

## Product scope

The network is not limited to commerce. Potential domains include professional services, jobs, education, travel, property, vehicles, equipment, healthcare administration, research, expertise, partnerships, communities, and information discovery. Each domain must pass its own safety, legal, evidence, and commercial validation before activation.

## Current baseline

- Product direction: global network for individual and organization-owned agents.
- Initial access: invitation-based global alpha, followed by controlled expansion and eventual public registration.
- Languages: Arabic and English from the beginning.
- Client: responsive web experience for mobile and desktop.
- Agent autonomy: owner-authorized discovery and communication; approval required for consequential actions.
- Privacy: owner-controlled field-level disclosure.
- Verification: tiered, scope-specific verification; a verification level never implies that every agent claim is true.
- Registry: hybrid discovery model (minimal central index plus compatible external/regional registries).
- Data residency: regional approach, subject to legal and operational validation.
- Retention: owner policy within applicable law, security, and legitimate operational constraints.

## Repository map

- `docs/00-project-charter.md` — mission, principles, scope, and governance.
- `docs/01-product-requirements.md` — actors, journeys, functional requirements, and acceptance criteria.
- `docs/02-system-architecture.md` — logical architecture, trust boundaries, and deployment model.
- `docs/03-security-privacy-trust.md` — threat model, authorization, approvals, privacy, and trust.
- `docs/04-data-governance.md` — data classification, lifecycle, residency, retention, and audit.
- `docs/05-interoperability.md` — standards strategy and integration boundaries.
- `docs/06-delivery-quality.md` — engineering controls, testing, release, operations, and stage gates.
- `docs/07-commercial-validation.md` — market hypotheses, validation plan, and enterprise-readiness evidence.
- `docs/08-open-decisions-register.md` — decisions, owners, evidence, and unresolved questions.
- `docs/09-risk-register.md` — product, technical, legal, security, and commercial risks.
- `docs/ar/overview.md` — Arabic project overview.

## Status and evidence discipline

This repository currently contains a **documentary baseline**, not a running product. No production system, security certification, legal compliance assessment, customer commitment, market demand, funding, or partnership is claimed. Requirements marked as proposed or requiring validation must not be presented as implemented facts.

## Working rules

- No destructive database operations or irreversible repository changes without explicit approval.
- No secrets, personal data, customer records, or sensitive evidence in source control.
- No paid infrastructure, APIs, or external outreach without explicit approval.
- Every material architectural decision receives an Architecture Decision Record (ADR).
- Every release must pass its defined acceptance, security, privacy, and rollback gates.
- Changes to approved product decisions require an explicit decision record and owner approval.

## Intended first milestone

Complete the baseline specification, validate critical assumptions with evidence, and produce a reviewable architecture package before implementation. The project must earn the right to build each capability through clear user value, safety feasibility, interoperability, and cost evidence.
