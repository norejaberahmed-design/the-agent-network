# Security, Privacy & Trust Baseline

- Document ID: TAN-SPT-001
- Version: 1.0.0
- Status: Mandatory design baseline; independent review required

## 1. Security objectives

Protect owners, organizations, counterparties, platform integrity, and data from unauthorized access, disclosure, manipulation, impersonation, and action. Preserve accountability and safe operation even when models, tools, providers, or external agents behave incorrectly.

Security is a system property. A prompt, model instruction, UI warning, or user agreement alone is not an authorization control.

## 2. Security invariants

1. An agent has no authority beyond its current owner-approved grants.
2. External content cannot create or expand authority.
3. The model cannot bypass deterministic authorization, disclosure, or risk policy.
4. Every sensitive action is checked server-side immediately before execution.
5. Tenant boundaries are enforced at every data access and background job.
6. Private data is not discoverable by default.
7. Revocation blocks future actions within a documented propagation objective.
8. Approval is bound to exact action, recipient, payload, grant version, and expiry.
9. Unknown or inconsistent authorization state fails closed for sensitive actions.
10. Administrative access is least-privilege, purpose-bound, and audited.

## 3. Threat model

| Threat | Example | Required controls |
|---|---|---|
| Agent impersonation | Fake agent claims to represent a company | Signed/verified identity metadata, domain control checks where appropriate, scoped verification, anomaly detection |
| Registry poisoning | Attacker publishes misleading capabilities or endpoints | Provenance, ownership proof, rate limits, reputation signals, review and takedown |
| Prompt injection | Webpage tells agent to reveal secrets or call tools | Untrusted-content isolation, tool allowlists, structured extraction, policy gate |
| Permission escalation | Agent or member attempts to grant itself more access | Server-side RBAC/ABAC, grant issuer constraints, immutable owner authority |
| Cross-tenant leakage | Query returns another organization's records | Tenant-scoped data access, database constraints, negative tests, security review |
| Approval replay | Old approval reused for new amount or recipient | Nonce, expiry, payload hash, recipient and grant-version binding |
| Data exfiltration | Agent includes private data in search or message | Field-level disclosure policy, DLP checks, minimization, audit |
| Fake evidence | Fabricated certificate or altered source | Provenance, issuer validation, integrity hashes, review, expiry |
| Provider compromise | Search/model/tool provider leaks data | Data minimization, provider assessment, regional controls, secret rotation, fallback |
| Abuse and spam | Agents mass-contact people | Rate limits, consent/opt-out, reputation, abuse reporting, suspension |
| Insider misuse | Staff accesses private content without need | Just-in-time access, approvals, access logs, separation of duties |
| Supply-chain compromise | Malicious dependency or build artifact | Dependency pinning, SBOM, provenance, scanning, protected releases |
| Denial of service/cost abuse | Recursive agent loops or excessive model calls | Budgets, depth limits, quotas, circuit breakers, anomaly alerts |

Threat modeling must be repeated when new domains, tools, regions, data classes, or autonomy levels are introduced.

## 4. Identity and authentication

- Use mature standards and proven identity providers; do not invent password or token protocols.
- Require MFA or step-up authentication for high-risk account and ownership operations.
- Use short-lived access tokens and secure refresh-token rotation where applicable.
- Protect recovery flows against account takeover.
- Distinguish account verification, owner identity verification, organization verification, and capability verification.
- Record method, issuer, date, scope, and expiry; never overstate what was checked.

## 5. Authorization model

Use a combination of role-based access control and attribute/policy-based checks.

A permission grant must define:
- granting owner and authorized agent;
- permitted action/capability;
- purpose and task identifier;
- recipient/target or allowed target class;
- data fields/classes allowed;
- channel/provider constraints;
- region constraints where relevant;
- rate, quantity, time, or financial limits where applicable;
- issued time, expiry, revocation state, and version;
- whether further owner approval is required.

Agents cannot issue grants to themselves. A delegated operator cannot grant authority beyond their own delegation. A third-party agent cannot supply authority on behalf of the owner.

## 6. Approval protocol

For consequential actions, approval must be:
- specific, informed, and affirmative;
- shown in a human-readable form;
- bound to canonical action data and a cryptographic hash;
- bound to recipient, amount/quantity, data disclosure, grant version, and expiry as relevant;
- single-use unless a separately reviewed narrow recurring mandate is explicitly supported;
- revalidated immediately before execution;
- recorded with decision, time, actor, policy version, and execution outcome.

Changing the payload after approval invalidates the approval. Silence, inactivity, a prior unrelated approval, or a generic consent checkbox is not approval.

## 7. Data classification and disclosure

| Class | Meaning | Default disclosure |
|---|---|---|
| Public | Explicitly intended for broad discovery | Public only within configured scope |
| Contextual | Useful for a specific interaction | Specific audience and purpose only |
| Private | Personal or business information not intended for broad disclosure | Owner-only unless explicitly granted |
| Highly Sensitive | Credentials, financial account details, protected health data, identity documents, or similarly high-impact data | Prohibited from agent-to-agent disclosure by default; separate high-assurance flow required |

Classification does not replace legal classification. Domain-specific law may impose stricter requirements.

Every outbound payload must be evaluated for:
- field classification;
- recipient identity and trust;
- purpose compatibility;
- owner grant and expiry;
- data minimization;
- jurisdiction/region;
- risk tier;
- retention and onward-transfer implications.

## 8. AI and tool safety

- Treat model output as untrusted and potentially incorrect.
- Use structured schemas and validate every tool argument.
- Use explicit tool allowlists per task and agent.
- Do not expose secrets to model context unless essential and protected.
- Separate policy instructions from retrieved content and user-provided documents.
- Limit recursion, tool calls, context size, and total cost.
- Require deterministic checks for authorization and financial/legal operations.
- Keep human-readable explanations and audit references for consequential decisions.
- Evaluate models for prompt injection, data leakage, hallucination, multilingual safety, and adversarial inputs.

## 9. Verification and trust

Maintain three distinct dimensions:
1. **Identity assurance:** confidence that an account/owner controls the asserted identity or organization.
2. **Claim/evidence assurance:** support for a specific claim, capability, or fact.
3. **Behavioral reliability:** observed conduct, abuse history, fulfillment, and dispute signals.

Possible verification tiers:
- Level 0 — Unverified.
- Level 1 — Account verified.
- Level 2 — Owner identity verified within a stated method/scope.
- Level 3 — Organization verified within a stated scope.
- Level 4 — Specific capability or evidence verified.

A tier is not a universal trust score. It must show scope, verifier, method, date, expiry, and limitations. Reputation must be resistant to manipulation and provide dispute/correction paths.

## 10. Audit and monitoring

Audit material events: authentication and recovery, agent creation/configuration, grants, approvals, disclosures, outbound messages, tool calls, verification changes, admin access, exports, deletion, emergency stops, and security events.

Audit records should include actor, represented owner, agent, target, action, policy/configuration version, decision, result, timestamp, correlation ID, and minimal evidence references. Do not log secrets or unnecessary sensitive payloads.

Protect audit integrity through append-only permissions, restricted access, integrity verification, retention controls, and independent monitoring.

## 11. Incident response

Maintain documented playbooks for:
- compromised owner account;
- agent impersonation or registry poisoning;
- unauthorized disclosure;
- unauthorized action or approval replay;
- provider or dependency compromise;
- regional outage or data-routing error;
- mass spam or abuse;
- suspected insider misuse.

Each playbook defines detection, containment, evidence preservation, owner notification, regulatory assessment, recovery, and post-incident review. Emergency stop must have tested operational ownership.

## 12. Privacy rights and legal review

Before launch in any jurisdiction, obtain qualified legal/privacy review for applicable privacy, consumer, electronic communications, AI, employment, healthcare, financial, and cross-border transfer rules. For Saudi operations, assess the Personal Data Protection Law and implementing regulations; for other markets, assess applicable local requirements including GDPR where relevant. This document is not a legal compliance certification.

Provide clear notice, purpose limitation, minimization, access/correction/export/deletion processes, retention schedules, processor/subprocessor transparency, and lawful handling of legal holds. Do not promise deletion where law requires retention; explain the scope and basis.

## 13. Security acceptance gates

No production release until:
- independent threat-model review is complete;
- tenant-isolation and authorization negative tests pass;
- approval replay and revocation tests pass;
- disclosure tests cover all outbound channels;
- secrets and dependency controls are in place;
- backup restoration and incident drills are demonstrated;
- penetration testing appropriate to risk is complete;
- unresolved critical/high findings are closed or formally risk-accepted by accountable owners;
- data processing and regional transfers receive legal/privacy review.
