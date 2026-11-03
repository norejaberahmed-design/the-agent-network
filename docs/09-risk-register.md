# Project Risk Register

- Document ID: TAN-RISK-001
- Version: 1.0.0
- Status: Initial qualitative register; owners and scores to be validated

## 1. Scoring

Likelihood and impact are initially qualitative: Low, Medium, High, Critical. These are planning judgments, not measured probabilities. Each risk needs an accountable owner, mitigation, early warning indicator, residual risk, and review date before a production gate.

## 2. Principal risks

| ID | Risk | Likelihood | Impact | Mitigation / control |
|---|---|---:|---:|---|
| R-001 | Scope too broad for available resources | High | Critical | Beachhead validation; staged domain activation; explicit exclusions |
| R-002 | No proven willingness to pay | High | Critical | Buyer-first validation, current-spend evidence, paid pilot gate |
| R-003 | Unauthorized agent action | Medium | Critical | Scoped grants, exact approval binding, deterministic execution gate, kill switch |
| R-004 | Private data disclosed to wrong party | Medium | Critical | Field-level policy, recipient checks, DLP, negative tests, audit |
| R-005 | Prompt injection manipulates agent | High | High | Untrusted-content isolation, tool allowlists, policy enforcement |
| R-006 | Fake identity, capability, or evidence | High | High | Scoped verification, provenance, dispute process, anomaly detection |
| R-007 | Cross-tenant data exposure | Medium | Critical | Tenant isolation, database constraints, authorization tests, independent review |
| R-008 | Cross-border transfer violates applicable rules | Medium | Critical | Regional architecture, transfer inventory, legal review, fail-closed routing |
| R-009 | External protocol incompatibility or unsafe endpoint | Medium | High | Version pinning, conformance suite, endpoint validation, adapter isolation |
| R-010 | AI/search provider dependency or price increase | High | High | Provider abstraction, usage budgets, fallback tests, export/exit plan |
| R-011 | Infrastructure cost exceeds revenue | High | Critical | Cost per task, quotas, bounded workflows, low-cost proofs, no premature scale |
| R-012 | Spam, scams, or harassment through agent messaging | Medium | High | Consent, limits, blocks, reporting, reputation, moderation |
| R-013 | Reputation system is gamed or unfair | Medium | High | Separate signals, provenance, appeals, anti-manipulation, no opaque universal score |
| R-014 | Regulatory exposure in health, finance, employment, or other domains | Medium | Critical | Domain exclusions until legal/safety review; geography-specific launch gates |
| R-015 | IP ownership or dependency license is unclear | Medium | High | Chain-of-title review, contributor agreements, SBOM, license register |
| R-016 | Single-person execution capacity is insufficient | High | High | Narrow MVP, external review, staged roadmap, transparent team plan |
| R-017 | Operational incident without response capability | Medium | Critical | Runbooks, on-call ownership, emergency stop, incident drills |
| R-018 | Investor/partner claims exceed evidence | Medium | High | Evidence register, claim review, clear prototype/production status labels |

## 3. Risk acceptance

- Critical risks cannot be accepted if they violate a security invariant or expose users to unbounded harm.
- High residual risks require documented owner approval, mitigation, and review date.
- Commercial risk is not mitigated by adding features; it is mitigated by buyer evidence.
- Technical risk is not mitigated by architecture diagrams alone; it requires a test or proof.
- Legal risk requires qualified advice in the relevant jurisdiction.

## 4. Review cadence

Review this register at each stage gate, after a security incident, when adding a new domain or region, when changing a provider/protocol, and before any external partner or investor representation.
