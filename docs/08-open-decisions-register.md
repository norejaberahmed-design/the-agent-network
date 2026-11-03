# Open Decisions & Architecture Decision Register

- Document ID: TAN-ADR-REGISTER-001
- Version: 1.0.0
- Status: Active register

## 1. Decision governance

A decision is not approved because it appears in a draft. Each record includes ID, status, context, options, decision, rationale, consequences, owner, evidence, and review trigger.

Statuses:
- **Approved:** explicitly accepted product direction.
- **Proposed:** recommended but not yet approved.
- **Open:** evidence or owner decision required.
- **Superseded:** replaced by a later approved decision.
- **Rejected:** considered and declined, with rationale.

## 2. Approved product direction

| ID | Decision | Status | Notes |
|---|---|---|---|
| PD-001 | Global product ambition | Approved | Launch remains invitation-led |
| PD-002 | Individuals and organizations can own agents | Approved | Ownership separate from membership |
| PD-003 | Invitation-based global alpha first | Approved | Controlled expansion before public registration |
| PD-004 | Arabic and English from the beginning | Approved | RTL/LTR are first-class |
| PD-005 | Responsive web client | Approved | Mobile and desktop |
| PD-006 | Owner-authorized autonomy | Approved | Discovery/communication within grants; consequential action approval |
| PD-007 | Owner-controlled field disclosure | Approved | Field-level policy |
| PD-008 | Tiered verification | Approved | Scope-specific, not universal trust |
| PD-009 | Regional data residency approach | Approved direction | Exact regions/providers open |
| PD-010 | Hybrid registry | Approved | Minimal central index plus external/regional registries |
| PD-011 | Owner retention policy within law | Approved direction | Per-category schedules still required |

## 3. Proposed architecture decisions

| ID | Proposal | Status | Validation needed |
|---|---|---|---|
| AD-001 | Modular monolith before service extraction | Proposed | Team, load, deployment and isolation proof |
| AD-002 | PostgreSQL as transactional system of record | Proposed | Hosting, residency, operations, cost |
| AD-003 | Queue-backed durable workers | Proposed | Job semantics, failure recovery, vendor-neutral options |
| AD-004 | Provider abstraction for models/search/tools | Proposed | Capability and quality evaluation |
| AD-005 | Relational search first; vector retrieval only when useful | Proposed | Benchmark on representative tasks |
| AD-006 | Global control plane plus regional data planes | Proposed | Legal and infrastructure feasibility |
| AD-007 | A2A/MCP/OAuth-OIDC/OpenAPI/JSON Schema where appropriate | Proposed | Version and conformance review |
| AD-008 | Append-only audit event model | Proposed | Tamper evidence, retention, cost |

## 4. Open decisions requiring owner/evidence

| ID | Question | Why it matters | Required evidence/approval |
|---|---|---|---|
| OD-001 | Which beachhead customer segment launches first? | Prevents broad unfocused build | Buyer interviews, spend evidence, paid pilot path |
| OD-002 | Which legal entity and jurisdiction will own the IP? | Contracts, investment, tax, liability | Qualified legal advice and owner decision |
| OD-003 | What is the initial region for the first pilot? | Residency, latency, support | Data mapping and jurisdictional review |
| OD-004 | Which verification vendors/methods are acceptable? | Cost, coverage, privacy | Provider due diligence and alternatives |
| OD-005 | What exact fields are permitted in global registry? | Privacy and discoverability | Data protection review and user testing |
| OD-006 | What are domain-specific risk policies? | Prevents unsafe generic policy | Legal/security/domain review |
| OD-007 | What are retention periods by data category? | Deletion and compliance | Legal basis and operational need |
| OD-008 | Which AI/search providers and regions are allowed? | Data transfer, quality, cost | Evaluation, contracts, residency review |
| OD-009 | What are pilot scale and support commitments? | Reliability and cost | Validated capacity and budget |
| OD-010 | What pricing and business model fit the beachhead? | Sustainability | Willingness-to-pay and unit economics |
| OD-011 | What IP license and contribution policy apply? | Investment/acquisition diligence | Owner decision and legal review |
| OD-012 | What are uptime, latency, RTO, and RPO targets? | Architecture and operations | Workload and business-impact analysis |
| OD-013 | Which actions are permanently prohibited vs approval-gated? | User safety and liability | Risk appetite and legal review |
| OD-014 | What is the dispute, appeal, and reputation correction process? | Trust and fairness | Governance design and user research |

## 5. Mandatory ADR template

For each material decision:

- ID and title
- Status and date
- Decision owner and reviewers
- Context and problem
- Constraints and invariants
- Options considered
- Decision and rationale
- Security/privacy/legal implications
- Cost and operational implications
- Migration and compatibility implications
- Consequences and accepted risks
- Evidence and sources
- Review trigger / revisit date

## 6. Change discipline

Approved product direction must not be changed implicitly in implementation. Any proposed change must identify the affected requirements, users, data, APIs, contracts, migrations, security posture, and commercial assumptions. If a decision must change due to new evidence, law, or technology, document the reason and migration path rather than preserving a known-bad decision merely to avoid change.
