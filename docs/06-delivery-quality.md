# Engineering Delivery, Quality & Operations

- Document ID: TAN-QUALITY-001
- Version: 1.0.0
- Status: Baseline delivery policy

## 1. Delivery philosophy

Build in evidence-backed stages. Do not implement every proposed domain at once. The platform foundation must be small enough to validate, but its security and ownership boundaries must be correct before autonomy or scale is introduced.

## 2. Stage plan and exit gates

### Stage 0 — Foundation and validation
Deliverables: approved charter, PRD, architecture, data governance, threat model, integration strategy, risk register, commercial hypotheses, and decision log.

Exit gate: critical unknowns identified; initial customer/problem evidence plan approved; no unresolved contradiction in ownership, privacy, grants, or approvals.

### Stage 1 — Technical proof
Validate the highest-risk assumptions with small, disposable proofs: tenant isolation, scoped grants, approval binding/replay prevention, regional routing constraints, protocol interoperability, and provider abstraction.

Exit gate: test results documented, cost measured, architecture updated by ADR where evidence requires it. Proof code is not production code.

### Stage 2 — Secure platform core
Implement identity, organizations, agent ownership, configuration, disclosure policy, grants, approvals, audit, and emergency stop.

Exit gate: security review, authorization negative tests, migration and restore tests, observability, and documented operational runbooks.

### Stage 3 — Controlled discovery and communication
Add internal registry, intent/discovery workflow, evidence provenance, match explanations, and permissioned messaging.

Exit gate: relevance and evidence quality meet pilot thresholds; abuse controls and owner controls demonstrated.

### Stage 4 — Invitation alpha
Invite a small, intentionally diverse group of individuals and organizations globally, with clear terms, support, incident response, and region limitations.

Exit gate: user outcomes, safety, retention, cost, and reliability measured; critical incidents resolved; expansion approved.

### Stage 5 — Domain expansion and public access
Expand domains and registration only after each domain's legal, safety, trust, support, and commercial gates pass.

## 3. Engineering workflow

- Trunk/main branch protected; changes proposed through reviewed branches and pull requests.
- Every change links to requirements and acceptance tests.
- No direct production changes without traceable review.
- Architecture decisions are recorded before irreversible dependency or schema choices.
- Dependency versions are pinned and periodically reviewed.
- Build artifacts are reproducible and attributable to source commits.
- Secrets never enter Git history.
- Database migrations are forward-compatible and reversible where feasible.
- Destructive migrations require backup verification, explicit approval, and a tested restore plan.
- Feature flags control risky capabilities and permit rapid disablement.

## 4. Required test layers

1. Unit tests for domain rules and policy decisions.
2. Property-based tests for permission and disclosure invariants.
3. Integration tests for database transactions, queue behavior, and provider adapters.
4. Contract tests for API and external protocol compatibility.
5. End-to-end tests for owner journeys and approval flows.
6. Negative security tests for cross-tenant access, privilege escalation, replay, injection, and leakage.
7. Load and soak tests for measured workload assumptions.
8. Disaster recovery and backup restoration tests.
9. Accessibility and localization tests, including Arabic RTL.
10. Human evaluation of AI output quality, evidence fidelity, and explanation quality.

A passing happy-path demo is not a release-quality test result.

## 5. Release gates

A release is blocked by:
- unresolved critical security/privacy defect;
- failed tenant isolation or authorization test;
- unbounded or unmonitored agent/tool loop;
- missing migration/backup/restore plan;
- missing rollback or kill switch for risky capability;
- unreviewed new data category or region transfer;
- missing operational owner or incident path;
- unapproved paid dependency or material cost exposure.

High-risk residual issues require written risk acceptance by the accountable owner and must not violate a non-negotiable security invariant.

## 6. Operations and SRE

Define service-level indicators and objectives only after measuring actual workload. Candidate indicators:
- API availability and latency by endpoint;
- queue age and job completion;
- discovery completion and evidence freshness;
- approval delivery and processing;
- authorization/policy service health;
- provider error and timeout rates;
- cost per task and per active owner;
- incident frequency and recovery time.

Runbooks must cover deployment, rollback, database restore, credential rotation, provider outage, regional failure, abuse escalation, and emergency stop.

## 7. AI quality and cost controls

- Model/provider selection uses task-specific evaluations, not brand preference.
- Record model version, prompt/template version, tool set, and relevant policy version for reproducibility.
- Use deterministic validation for structured outputs and privileged actions.
- Apply per-owner, per-agent, per-task, and platform budgets.
- Bound retries, recursion depth, context size, and tool calls.
- Cache only when privacy and freshness permit.
- Provide provider fallback only if the fallback preserves policy and data-region requirements.
- Measure useful task completion, not raw token volume.

## 8. Change and migration policy

Every schema or API change includes:
- compatibility impact;
- migration plan;
- backfill and validation plan;
- rollback or forward-fix plan;
- data retention and deletion implications;
- performance and cost impact;
- test coverage.

Use expand-migrate-contract for database changes where practical. Never reset or replace production data to make a migration easier.

## 9. Documentation as a release artifact

Each release updates API contracts, data dictionary, architecture diagrams, threat model, operational runbooks, compatibility matrix, known limitations, and change log as applicable. Documentation must describe actual behavior, not intended behavior masquerading as implementation.

## 10. Definition of done

A capability is done only when requirements, server-side enforcement, tests, accessibility/localization, security/privacy review, telemetry, documentation, operational ownership, cost controls, and rollback behavior are complete.
