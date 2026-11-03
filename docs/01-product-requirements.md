# Product Requirements — The Agent Network

- Document ID: TAN-PRD-001
- Version: 1.0.0
- Status: Baseline specification; validation required
- Normative terms: **MUST**, **MUST NOT**, **SHOULD**, and **MAY** express requirement strength.

## 1. Product outcome

Enable a person or organization to configure an owner-controlled agent that can safely represent approved information and intent, discover relevant counterparties and sources, evaluate evidence, and coordinate interactions without exceeding its authority.

## 2. Actors

- Individual owner
- Organization owner
- Organization member (Owner, Admin, Agent Manager, Operator, Auditor, Viewer)
- Agent
- External agent
- Platform administrator / trust and safety operator
- Integration provider
- Public information source

Organization roles are not interchangeable. An employee's ability to operate an agent does not make them the owner of the organization or its data.

## 3. Core journeys

### J1 — Create and configure an agent
1. User creates an account and completes the applicable verification tier.
2. User creates an individual or organization-owned agent.
3. User declares its purpose, capabilities, supported languages, and discoverability.
4. User selects which profile fields are public, contextual, private, or highly sensitive.
5. User reviews default permissions and explicitly enables only necessary capabilities.
6. System records versioned configuration and audit events.

Acceptance: no agent becomes publicly discoverable or gains external communication authority by default unless the owner explicitly enables it.

### J2 — Discover a person, organization, service, or agent
1. Owner expresses an intent and constraints.
2. System classifies sensitive details and builds a minimized search representation.
3. Search runs against permitted internal registry, external registries, and public sources.
4. Candidate claims are normalized with provenance, timestamp, and confidence state.
5. Hard constraints are applied before relevance ranking.
6. Results distinguish fit from trust and expose evidence gaps.
7. Owner chooses whether to initiate contact.

Acceptance: private constraints are not disclosed to a candidate or external search provider unless a valid policy permits the specific disclosure.

### J3 — Agent-to-agent communication
1. Initiating agent checks its grant, recipient, purpose, channel, and data scope.
2. Recipient identity and endpoint are resolved and checked.
3. Disclosure policy filters message content.
4. Message is sent with provenance and correlation identifiers.
5. Incoming content is treated as untrusted input.
6. The owner can inspect, pause, revoke, or block communication.

Acceptance: a received message cannot grant permissions, alter system policy, trigger tool execution, or override owner instructions.

### J4 — Consequential action
1. Agent prepares a specific proposed action.
2. Policy engine classifies its risk and checks the grant.
3. System displays exact recipient, action, amount/data, terms, and consequences where applicable.
4. Owner provides a fresh, explicit approval bound to the exact payload, recipient, and grant version.
5. System revalidates the grant and policy immediately before execution.
6. Action result and evidence are recorded.

Acceptance: no approval can be replayed for a different payload, recipient, amount, or later task. Expired or revoked grants fail closed.

### J5 — Organization agent management
1. Organization owner creates an organization space.
2. Owner invites members and assigns least-privilege roles.
3. Agent ownership is assigned to the organization, not to an employee account.
4. Members operate only within assigned scopes.
5. Role changes and offboarding revoke relevant sessions, grants, and delegated access.
6. Audit records remain available according to retention policy.

Acceptance: no member can silently transfer organization ownership, bypass approval rules, or read unrelated tenant data.

### J6 — Verification and trust
1. Subject submits evidence for a defined claim or capability.
2. Verification process records issuer, method, scope, time, expiry, and limitations.
3. Registry exposes only permitted verification metadata.
4. Claim confidence is evaluated separately from identity assurance and behavior.
5. Expired or challenged evidence is downgraded or marked for review.

Acceptance: a verified account or organization is never represented as having all its claims verified.

## 4. Functional requirements

### Identity, ownership, and access
- FR-001: System MUST distinguish User, Organization, Membership, and Agent as separate domain entities.
- FR-002: An agent MUST have an explicit owner type and owner identifier.
- FR-003: Individuals and organizations MAY own multiple agents.
- FR-004: Organization roles MUST be enforced server-side on every protected operation.
- FR-005: Ownership transfer MUST require a verified, explicit, audited workflow.
- FR-006: Invitation redemption MUST be single-use, expiring, and bound to its intended context.
- FR-007: Account recovery and high-risk changes SHOULD require step-up authentication.

### Agent profile and configuration
- FR-008: Each agent MUST declare purpose, capabilities, languages, status, and discoverability.
- FR-009: Capability declarations MUST be treated as claims, not proof of competence.
- FR-010: Owner preferences MUST support constraints, priorities, and prohibited outcomes.
- FR-011: Configuration changes MUST be versioned and auditable.
- FR-012: Agent status MUST support active, paused, suspended, and revoked states.

### Privacy and disclosure
- FR-013: Each data field MUST have a classification and disclosure policy.
- FR-014: Disclosure MUST be purpose-bound, audience-bound, and minimized.
- FR-015: Private and highly sensitive data MUST NOT enter public registry indexes.
- FR-016: A policy engine MUST evaluate outbound messages, search requests, and integration payloads.
- FR-017: Owners MUST be able to review and revoke ongoing disclosure grants.
- FR-018: Revocation MUST prevent future disclosure but MUST NOT falsely imply that previously delivered data can be recalled.

### Discovery and matching
- FR-019: System MUST support internal registry discovery.
- FR-020: System SHOULD support public web and external registry discovery through controlled connectors.
- FR-021: Search requests MUST preserve explicit constraints and avoid unnecessary sensitive details.
- FR-022: Hard constraints MUST be evaluated separately from relevance ranking.
- FR-023: Results MUST expose source, observation time, freshness, and uncertainty.
- FR-024: Conflicting claims MUST remain distinguishable; the system MUST NOT silently merge them into one fact.
- FR-025: Match quality and trust assurance MUST be separate dimensions.
- FR-026: The owner MUST be able to inspect why a candidate was suggested.

### Messaging and coordination
- FR-027: Messages MUST identify the sending agent and, where permitted, the represented owner/organization.
- FR-028: Disclosure policy MUST run before outbound transmission.
- FR-029: External messages MUST be treated as untrusted data.
- FR-030: Rate limits, abuse reporting, blocking, and communication pause MUST be supported.
- FR-031: The platform MUST maintain correlation identifiers and auditable delivery states.
- FR-032: No message may authorize an action outside the initiating owner's grant.

### Permissions and approvals
- FR-033: Every tool or action MUST require a scoped permission grant.
- FR-034: Grants MUST specify purpose, action scope, target/recipient, data scope, expiry, and applicable limits.
- FR-035: Grants MUST be revocable and versioned.
- FR-036: The agent MUST NOT expand its own authority or infer authority from external content.
- FR-037: High-risk and consequential actions MUST require a fresh, informed approval.
- FR-038: Approval MUST bind to exact action payload, recipient, grant version, and expiry.
- FR-039: The platform MUST revalidate authorization immediately before execution.
- FR-040: Emergency stop MUST be available per agent, owner/organization, and platform-wide.

### Evidence, verification, and trust
- FR-041: Evidence records MUST include source, source type, capture time, claim linkage, and integrity metadata where feasible.
- FR-042: Claims MUST support verified-with-scope, supported, partially supported, unverified, conflicting, and stale states.
- FR-043: Identity assurance, claim/evidence assurance, and behavioral reliability MUST be represented separately.
- FR-044: Verification MUST state method, issuer, scope, time, and expiry/refresh conditions.
- FR-045: Trust scores MUST NOT conceal missing evidence or be presented as universal truth.

### Governance and audit
- FR-046: Material actions MUST create append-only audit events with actor, owner, policy version, target, outcome, and correlation ID.
- FR-047: Administrative access MUST be purpose-bound, restricted, and audited.
- FR-048: Users MUST have supported access, correction, export, and deletion workflows subject to applicable law and legitimate retention duties.
- FR-049: Security incidents and abuse reports MUST have documented triage and escalation paths.
- FR-050: Domain-specific regulated features MUST remain disabled until a dedicated safety and legal review is approved.

## 5. Risk tiers and approval policy

| Tier | Example | Default handling |
|---|---|---|
| Low | Public-source lookup, local ranking | May run within an explicit task grant |
| Moderate | Drafting a message, requesting public information | May prepare; send only if communication grant permits |
| High | Disclosing contextual/private data, making a representation on owner's behalf | Explicit per-action approval unless a narrowly scoped, reviewed policy allows otherwise |
| Critical | Purchase, payment, signature, binding commitment, sensitive data transfer, regulated/high-impact decision | Fresh explicit approval for exact action; additional controls or out-of-scope prohibition |

Risk classification is contextual. A seemingly ordinary action may become high risk because of its recipient, data, jurisdiction, or consequences.

## 6. Non-functional requirements (targets to validate)

- Security: least privilege, tenant isolation, secure secrets, encryption in transit and at rest, tested recovery.
- Availability: service-level objectives to be set after workload and hosting design; no unsupported uptime promise.
- Performance: define p95/p99 targets per endpoint after baseline measurements.
- Scalability: stateless request services where practical; queue-backed background work; partitioning only when measured need exists.
- Accessibility: target WCAG 2.2 AA for user-facing flows, subject to formal testing.
- Localization: Arabic RTL and English LTR, locale-aware dates/numbers, translated consent and approval screens.
- Observability: structured logs, metrics, traces, security events, and cost attribution.
- Portability: provider abstraction and documented export formats.
- Resilience: idempotency, bounded retries, dead-letter handling, backup/restore tests, and rollback.

## 7. Explicit exclusions for initial release

No autonomous custody of funds, autonomous payment execution, legal signature, binding contracting, medical diagnosis, high-impact eligibility decisions, or unrestricted execution of third-party agent instructions. These require separate product, legal, security, and risk approval.

## 8. Requirement traceability

Each requirement must map to:
- a user or business outcome;
- one or more domain/API/data components;
- acceptance tests;
- security/privacy controls where relevant;
- operational metrics;
- a release gate.

A requirement is not complete merely because a UI control exists. Enforcement must occur server-side and be covered by negative tests.
