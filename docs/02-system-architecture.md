# System Architecture — The Agent Network

- Document ID: TAN-ARCH-001
- Version: 1.0.0
- Status: Logical baseline; detailed design and threat review required

## 1. Architecture goals

The architecture must support global discovery and coordination while preserving owner control, tenant isolation, regional data governance, interoperability, and measurable operational cost. It must allow evolution without premature distributed-system complexity.

## 2. Architectural decisions

### AD-01 — Modular monolith first
Start with a modular monolith and separately deployable background workers where needed. Enforce domain boundaries in code and database ownership. Extract services only when scale, isolation, regulatory boundaries, or team topology provide evidence that extraction is worth its operational cost.

### AD-02 — Provider abstraction
Model AI, search, identity verification, messaging, storage, and observability behind explicit provider interfaces. Avoid coupling core domain logic to a single model vendor or tool API. Provider portability does not mean every provider is interchangeable; capabilities and safety behavior must be tested.

### AD-03 — Relational system of record
Use a transactional relational database as the authoritative store for users, organizations, agents, grants, approvals, messages metadata, evidence metadata, and audit references. PostgreSQL is the leading candidate, subject to deployment and cost validation. Vector search is optional and must not become the authority for permissions or factual claims.

### AD-04 — Asynchronous work
Long-running discovery, evidence processing, verification, and integration tasks use durable jobs with idempotency, bounded retries, cancellation, and dead-letter handling. A queue is not the source of truth for permissions.

### AD-05 — Hybrid registry
Maintain a minimal central discovery index and support compatible external/regional registries. Private profiles, conversations, and sensitive owner data do not become global registry content.

## 3. Logical layers

1. **Experience layer:** responsive web client, localization, owner console, organization console, approval inbox, agent status and audit views.
2. **Identity and edge layer:** authentication, session management, API gateway, rate limiting, request validation, tenant context.
3. **Core domain layer:** users, organizations, memberships, agents, capabilities, intents, discovery, conversations, grants, approvals, evidence, verification, audit.
4. **Policy and AI orchestration layer:** intent interpretation, risk classification, disclosure filtering, workflow orchestration, model/provider routing, structured output validation.
5. **Integration layer:** A2A-compatible agent communication, MCP tool access, public web/search connectors, webhooks, external registries, enterprise connectors.
6. **Data and infrastructure layer:** relational database, object storage, queue, cache, search indexes, secrets, telemetry, backup and recovery.

## 4. Domain boundaries

- Identity & Access: authentication, account lifecycle, sessions, MFA, organization membership.
- Agent Management: ownership, profiles, capabilities, configuration, lifecycle.
- Policy & Consent: data classification, disclosure decisions, permission grants, approvals, revocation.
- Discovery: intent, candidate retrieval, constraints, ranking, match explanation.
- Evidence & Verification: sources, claims, evidence, verification cases and scope.
- Communication: conversations, messages, delivery, abuse controls.
- Integration: adapters, protocol negotiation, external credentials, webhooks.
- Trust & Safety: reports, blocks, suspensions, risk signals, emergency stop.
- Audit & Compliance: immutable/append-only event records, export, retention workflows.
- Platform Operations: configuration, observability, cost, incident management.

A domain may expose APIs to other modules but must not bypass another domain's policy or write directly into its owned tables.

## 5. Trust boundaries and request flow

### Outbound agent action
1. Authenticate caller and establish tenant/owner context.
2. Load agent state and immutable configuration version.
3. Resolve requested capability and target.
4. Ask authorization service for a current grant.
5. Classify data and action risk.
6. Evaluate disclosure and domain policy.
7. If required, create an approval request with a canonical action payload and hash.
8. After approval, revalidate owner, target, grant version, policy version, expiry, and payload hash.
9. Execute through a narrowly scoped adapter.
10. Record outcome, evidence, cost, and audit event.

No model output may directly call a privileged tool. Model proposals are untrusted suggestions until deterministic policy and authorization checks approve them.

### Inbound external content
1. Verify transport and sender metadata where supported.
2. Apply size, content-type, malware, and abuse controls.
3. Treat message, attachment, webpage, tool output, and agent card as untrusted data.
4. Parse into typed data structures with schema validation.
5. Keep instructions found in external content separate from trusted system/developer/owner policy.
6. Do not let inbound content create grants, approvals, secrets, or executable code.
7. Store provenance and apply retention/disclosure rules.

## 6. Core conceptual entities

- User
- Organization
- OrganizationMembership
- Invitation
- Agent
- AgentProfile
- AgentCapability
- AgentPreference
- AgentConfigurationVersion
- IntentRequest
- DiscoveryJob
- Candidate
- MatchResult
- Source
- Evidence
- Claim
- VerificationCase
- VerificationEvidence
- VerificationScope
- Conversation
- Message
- PermissionGrant
- ApprovalRequest
- ApprovalDecision
- DisclosurePolicy
- AuditEvent
- SecurityEvent
- ReputationSignal
- ReputationAssessment
- RegistryNode
- RegistryEndpoint
- Region
- DataResidencyPolicy
- CrossRegionTransfer
- DataRetentionPolicy
- DeletionRequest

These are conceptual aggregates, not a finalized physical schema. Cardinalities, constraints, indexes, encryption boundaries, and ownership must be specified in a separate data design before implementation.

## 7. Regional deployment model

Target model: a global control plane plus regional data planes, subject to legal, latency, availability, and cost review.

- Global control plane stores only the minimum metadata needed for routing, policy coordination, and service health.
- Regional data planes store personal data, conversations, and other region-bound content according to policy.
- No automatic global replication of private data.
- Cross-region transfers require purpose, legal basis, destination, data minimization, safeguards, and auditable authorization.
- Regional outage must not silently route protected data to an unapproved region.
- Global discovery must not reveal private regional data.

The exact region map and provider selection remain open decisions.

## 8. Registry design

Central registry records should be minimal and policy-filtered: stable agent identifier, owner-approved public name/description, declared capabilities, languages, allowed discovery scope, supported protocol/endpoint metadata, verification summary with scope, region routing hint where permitted, status, and freshness.

The registry must not contain private profile fields, raw evidence, private messages, secrets, or unrestricted owner identifiers. External registry entries are untrusted until independently evaluated.

## 9. Data and consistency

- Relational database is authoritative for ownership, grants, approvals, and agent state.
- Search/vector indexes are derived, rebuildable projections.
- Sensitive authorization reads must use a sufficiently consistent authoritative source.
- Every grant has a monotonically increasing version or equivalent revocation epoch.
- Cached authorization decisions must have strict, documented invalidation and short bounded lifetime; critical actions revalidate at execution time.
- All state-changing requests support idempotency where retries may duplicate effects.
- Audit records use append-only semantics and tamper-evidence controls appropriate to the threat model.

## 10. Resilience and failure behavior

- Policy service unavailable: deny sensitive disclosure/action.
- Grant state uncertain: deny sensitive action.
- Approval mismatch or replay: reject and raise a security event.
- External provider unavailable: report partial failure; do not fabricate a result.
- Queue duplicate: idempotent processing.
- Model timeout or invalid structured output: bounded retry or safe fallback; never bypass policy.
- Regional routing uncertainty: do not send protected payload to an unapproved region.
- Emergency stop: immediately prevent new work; in-flight action handling must be defined per adapter and report whether cancellation is guaranteed.

## 11. Technology candidates (not purchasing commitments)

- Web: TypeScript and a mature responsive web framework.
- API/domain: TypeScript or another strongly typed backend stack selected after a technical spike.
- System of record: PostgreSQL.
- Search: conventional indexed search first; vector retrieval only where evaluated.
- Jobs: durable queue with idempotent workers.
- Storage: encrypted object storage with regional controls.
- Identity: standards-based OIDC/OAuth integration where appropriate.
- Telemetry: vendor-neutral structured logs, metrics, and traces.

No paid service is approved by this document. A technology decision requires total-cost, residency, security, portability, and operational review.

## 12. Architecture exit criteria

Before implementation: domain model reviewed, threat model reviewed, API contracts versioned, data residency plan assessed, approval/disclosure flows specified, failure modes tested on paper, cost model estimated, and a small technical proof validates the riskiest assumptions without committing to a full stack.
