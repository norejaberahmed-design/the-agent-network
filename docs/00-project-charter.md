# Project Charter — The Agent Network

- Document ID: TAN-CHARTER-001
- Version: 1.0.0
- Status: Baseline for review
- Date: 2026-11-03
- Product motto: **Your identity. Your agent. Your world.**

## 1. Mission

Create an open, global network where people and organizations can operate owner-controlled digital agents. An agent can represent explicitly authorized interests, capabilities, needs, and goals; discover relevant agents and public information; assess evidence; and coordinate interactions across organizational and technical boundaries.

The network is intended to make digital representation and agent-to-agent coordination broadly useful—not to create an autonomous actor that replaces the rights, judgment, or accountability of its owner.

## 2. Problem statement

Information, services, opportunities, and expertise are distributed across websites, applications, organizations, and disconnected agent systems. People and organizations must repeatedly describe their needs, compare options, establish trust, and coordinate with others. Existing assistants are commonly tied to one provider or application and do not provide a neutral, owner-controlled network identity with portable permissions and evidence.

These are product hypotheses, not yet proven market facts. The project must validate the frequency, severity, willingness to pay, and feasible distribution of these problems before expensive implementation.

## 3. Product thesis

A user or organization configures one or more agents. Each agent receives a limited digital identity, a capability description, owner-defined preferences, data-disclosure policies, and task-specific permissions. The network helps agents discover and communicate with other agents and permitted external sources. The owner remains the principal and final authority.

### 3.1 What the network is

- A discovery and coordination network for owner-controlled agents.
- A bridge between internal agents, external agents, public information, and approved tools.
- A policy-enforced environment for identity, permissions, disclosure, evidence, and accountability.
- A multi-domain platform whose domains are activated only after dedicated validation.

### 3.2 What the network is not

- Not merely a chatbot, social network, online marketplace, or single-purpose sales tool.
- Not a universal identity provider that claims to verify every real-world attribute.
- Not a promise that agents can safely or legally perform every task.
- Not a substitute for licensed professionals, regulated institutions, or accountable human decision-makers.
- Not a proprietary replacement for open agent, identity, and tool protocols without a demonstrated reason.

## 4. Confirmed product direction

The following decisions are treated as approved product direction and must not be silently changed:

| Area | Approved direction |
|---|---|
| Geographic ambition | Global |
| Owners | Individuals and organizations |
| Initial access | Global invitation-based alpha, then controlled expansion and public registration |
| Languages | Arabic and English from the beginning |
| Client | Responsive web for mobile and desktop |
| Agent autonomy | Owner-authorized discovery and communication; approval for consequential actions |
| Privacy | Owner controls field-level disclosure |
| Verification | Tiered, scoped verification |
| Registry | Hybrid: central minimal discovery index plus external/regional registries |
| Data residency | Regional approach, subject to jurisdictional validation |
| Retention | Owner policy within legal, security, and operational constraints |

## 5. Product principles

1. Owner sovereignty and clear accountability.
2. Least privilege and task-scoped authority.
3. Informed, specific, revocable approvals for consequential actions.
4. Privacy and data minimization by default.
5. Evidence provenance, freshness, and uncertainty disclosure.
6. Open interoperability and provider portability.
7. Regional data governance and explicit cross-border controls.
8. Safe failure for sensitive or irreversible operations.
9. Explainability sufficient for owners to understand why an agent acted.
10. Accessibility, localization, and inclusive design.
11. Abuse resistance and protection against manipulation.
12. Measurable value and sustainable unit economics.

## 6. Stakeholders and accountability

- **Individual owner:** controls their personal agent, disclosures, and grants.
- **Organization owner:** controls organization agents through a governed membership and role model.
- **Organization administrator:** manages approved organizational settings within delegated authority.
- **Agent operator:** manages permitted tasks but cannot grant ownership or elevate their own privileges.
- **Auditor:** views authorized audit evidence without gaining operational authority.
- **Network operator:** maintains platform infrastructure and safety controls; cannot casually inspect private agent content.
- **External agent/provider:** participates under declared protocol, identity, and trust boundaries.
- **Regulators and affected parties:** may have rights or requirements depending on jurisdiction and domain.

A platform role must never imply ownership of a user's data or agent. Organization membership and authority must be independently revocable and auditable.

## 7. Scope boundaries

### Initial platform foundation

- Accounts, organizations, membership, and agent ownership model.
- Agent identity and capability descriptions.
- Owner-configured preferences and disclosure policies.
- Permission grants, approval requests, revocation, and audit.
- Discovery and evidence model.
- Secure messaging/coordination foundations.
- Verification records with explicit scope and expiry.
- Integration interfaces and provider abstraction.
- Administrative abuse response and emergency stop.

### Deferred until validated

- Autonomous payments, escrow, wallets, or financial custody.
- Binding contract execution or electronic signatures.
- Autonomous medical diagnosis or treatment recommendations.
- High-impact employment, credit, insurance, or eligibility decisions.
- Biometric identity processing beyond a separately approved legal/security design.
- Cryptocurrency, tokenization, or blockchain-based trust.
- Training a foundation model from scratch.
- Unrestricted agent-to-agent execution or self-expanding permissions.

## 8. Governance model

The project uses documented decision rights:

- Product owner approves product scope and user-impacting policies.
- Security owner approves security architecture and residual-risk acceptance.
- Privacy/legal review is required before processing regulated or cross-border data.
- Engineering owner approves implementation design and operational readiness.
- No single technical convenience may override an approved safety invariant.
- Material decisions are recorded as ADRs with context, options, consequences, status, and review triggers.

## 9. Definition of a sound foundation

A foundation is accepted only when:
- Requirements are traceable to user outcomes and acceptance criteria.
- Domain boundaries and trust boundaries are explicit.
- Identity, ownership, permissions, privacy, and audit are designed before autonomy.
- API and data contracts are versioned and migration-safe.
- External content is treated as untrusted.
- Failure modes and rollback paths are specified.
- Security and privacy reviews are documented.
- Commercial assumptions are separated from proven evidence.
- No unvalidated claim is presented to partners or investors as a delivered capability.

## 10. Success measures

Measures must be baselined during a controlled pilot, not invented in advance:
- Time from user intent to useful, evidence-backed match.
- Match relevance and owner acceptance rate.
- Evidence completeness and stale/incorrect claim rate.
- Unauthorized disclosure and unauthorized action rate (target: zero).
- Approval comprehension and revocation effectiveness.
- Cross-provider interoperability success.
- Abuse, spam, impersonation, and incident rates.
- Retention, repeat use, referral, and willingness to pay.
- Cost per successful discovery/coordination task.
- Reliability, latency, and recovery objectives validated against actual workloads.

## 11. Change control

Approved direction changes only through an explicit proposal that states the reason, user impact, security/privacy impact, migration implications, alternatives, and approval. This is how the project avoids casual redesign while retaining the ability to respond to evidence, law, and technology changes.
