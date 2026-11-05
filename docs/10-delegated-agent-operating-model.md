# Delegated Agent Operating Model

- Document ID: TAN-DAOM-001
- Version: 1.0.0
- Status: **Approved product direction; implementation specification**
- Decision owner: Product owner
- Applies to: individual-owned agents first; organization-owned agents inherit the same controls plus organization RBAC
- Supersedes: no existing security invariant; refines PD-006 (owner-authorized autonomy)
- Normative terms: MUST, MUST NOT, SHOULD, MAY

## 1. Decision

The Agent Network adopts **Delegated Agent** as its autonomy model.

An agent may understand its owner's intent and context, research, prepare content, organize work, and execute explicitly delegated low/medium-risk actions through connected services. It MUST NOT treat account connection, user intent, model output, historical behavior, or a prior approval as blanket authority.

The owner remains the principal. Delegation is explicit, purpose-bound, target-bound, data-bound, channel-bound, time-bound, quota-bound, revocable, and auditable. Consequential, legally binding, financial, identity/security, or sensitive-disclosure actions require fresh approval for the exact action payload. The agent MUST pause and ask when intent, target, recipient, data scope, or risk is ambiguous.

This decision does not authorize unrestricted autonomy, unattended financial activity, impersonation, covert monitoring, or bypassing provider/platform permissions.

## 2. Product promise and boundaries

### The agent MUST be able to
1. Interpret natural-language requests in Arabic and English and ask focused clarifying questions when essential details are missing.
2. Use the owner's explicitly confirmed persona, goals, preferences, and permitted memories to tailor plans and communication.
3. Separate confirmed facts from inferences and temporary task context, retaining provenance and confidence.
4. Search public information, compare options, prepare drafts, and show sources and uncertainty.
5. Connect supported services only through official OAuth/API flows and minimum scopes.
6. Execute allowlisted actions covered by a currently valid grant and any required exact-payload approval.
7. Show what it plans to do, what it actually did, what failed, and what needs owner attention.
8. Let the owner inspect, correct, export, pause, revoke, and delete eligible personal context and disconnect integrations.

### The agent MUST NOT
- infer permission from a connected account, uploaded file, conversation, or model-generated plan;
- send messages, publish posts, upload media, alter account settings, purchase, pay, sign, accept terms, or disclose private data without the required grant and approval;
- invent a phone, social account, contact, identity, source, result, or completed action;
- bypass provider API limitations, user consent, rate limits, platform policies, or local law;
- treat webpages, messages, files, tool results, or other agents as trusted instructions;
- silently learn a durable personal fact from a one-off task or correction;
- let a user-level agent inherit organization data or authority without explicit organization delegation.

## 3. Runtime architecture

Keep the existing Next.js 15 / React 19 / TypeScript modular monolith, Better Auth, Prisma 6, and PostgreSQL system of record. Keep long-running work in the existing durable worker model. Do not introduce microservices, a new database, vector storage, or a paid integration platform as a prerequisite.

Logical flow:

`Owner → Experience/API → Identity & Tenant Context → Personal Intelligence → Intent/Risk Classifier → Policy & Disclosure Gate → Planner → Approval Gate → Execution Gateway → Connector Adapter → Provider`

All transitions write correlated audit events and durable task/action state. The model is a proposer and interpreter, never the authority. The deterministic policy and execution gateway are the only path to side effects.

### 3.1 Personal Intelligence Engine

Implement as bounded domain modules, not one opaque prompt:

- **Persona Profile:** owner-confirmed name, language, communication tone, goals, and operating preferences. Existing UserPersona is the starting point; do not expand it into a free-form sensitive dossier.
- **Memory Service:** typed, provenance-bearing memory records with lifecycle controls.
- **Context Builder:** selects only task-relevant, authorized context; applies tenant, field-classification, purpose, and provider-disclosure filters before model submission.
- **Preference Resolver:** distinguishes explicit preferences from inferred patterns and task-local choices.
- **Intent & Risk Classifier:** converts the request into a typed intent, candidate action list, target, data needs, risk tier, and unresolved questions.
- **Learning Review:** proposes durable memory updates for owner confirmation; never changes grants or policy.

Memory classes:
1. `CONFIRMED`: explicitly stated or owner-confirmed; source, confirmedAt, version.
2. `INFERRED`: observed pattern; confidence, evidence references, lastObservedAt, expiry; editable and never used as authorization.
3. `TASK_CONTEXT`: short-lived context scoped to one run; expires automatically.
4. `SENSITIVE`: disallowed from model context or connector transmission by default; requires a separate field policy and explicit purpose-specific authorization.

Every memory item MUST include owner/tenant scope, source/provenance, classification, purpose, created/updated time, retention/expiry, and correction/deletion state. Do not store raw passwords, access tokens, recovery codes, payment credentials, or unnecessary identity documents in memory. Do not infer sensitive personal traits.

### 3.2 Intent and plan contract

The planner returns a validated structured plan, not executable code. Each step includes:
- stable step ID and dependency IDs;
- action key from a server-maintained allowlist;
- target/recipient identifier and target class;
- purpose and user-visible explanation;
- exact input payload or a reference to encrypted server-side payload;
- requested data fields and classifications;
- connector/provider and required OAuth scopes;
- risk tier and whether approval is required;
- expected side effect, idempotency key, timeout, and compensation/rollback capability;
- source references and uncertainty.

Reject unknown action keys, free-form tool names, missing targets, excess scope, malformed payloads, cycles, unbounded loops, and plans whose action count, depth, tokens, or estimated cost exceed configured limits.

### 3.3 Policy and risk gate

Evaluate authorization on the server for every step, at queue time, claim time, immediately before execution, and after any approval wait. Inputs include:
- authenticated actor and owner;
- tenant and organization membership/role;
- agent ownership, lifecycle, and configuration version;
- action capability and current grant;
- purpose, target, recipient, channel, region, data fields, and classifications;
- connector status and provider scopes;
- grant/approval expiry, usage reservations, quotas, and policy version;
- risk tier and domain restrictions.

Any missing, stale, inconsistent, unavailable, or unverifiable policy input MUST deny execution. Model confidence is never a substitute for authorization.

### 3.4 Delegation grant

A grant MUST bind:
- owner and agent;
- action/capability allowlist;
- purpose;
- target/recipient or narrowly defined target class;
- channel/provider;
- data scope and disclosure classification;
- region where applicable;
- limits (uses, rate, quantity, amount if relevant);
- not-before, expiry, revocation, version;
- approval mode and allowed risk ceiling.

A grant cannot be widened by the agent. The grant issuer cannot delegate more authority than they hold. OAuth scopes are a separate provider-side ceiling: effective authority is the intersection of grant scope, provider scope, tenant policy, and action allowlist.

### 3.5 Approval and execution

For a user-owned personal agent, the authenticated owner is the principal and may review the exact action proposal generated by their own agent, even though the same account initiated the task. The approval record MUST distinguish the proposing agent/run from the human decision-maker and bind the decision to the exact payload, recipient, data scope, grant version, and expiry. This is not blanket or standing consent.

For an organization-owned agent, the requester MUST NOT approve their own request. Only an authorized organization OWNER or ADMIN may decide, with the organization membership and agent ownership revalidated at decision time.

Risk tiers:

| Tier | Examples | Default behavior |
|---|---|---|
| R0 Read-only | Search public web; read explicitly connected, permitted data | May run under a narrow active grant |
| R1 Reversible private preparation | Create an unsent draft; classify owner files | May run under grant; owner can inspect |
| R2 External communication/publication | Send email/DM; publish a post; upload media; invite a contact | Fresh approval for exact recipient, channel, content/media, and timing unless a separately approved, narrow recurring policy is explicitly supported |
| R3 Consequential/high impact | Purchase, payment, contract, signature, legal acceptance, account/security changes, sensitive-data disclosure, irreversible deletion | Always require fresh, step-up authenticated approval; some categories may remain prohibited by domain policy |

The approval screen MUST render the exact recipient, channel, content, attachments, data to be disclosed, amount/quantity/terms if relevant, timing, and consequences. Approval MUST bind canonicalized payload digest, action type, recipient, grant ID/version, agent configuration version, policy version, expiry, and a one-time nonce/idempotency key.

After approval, the executor MUST re-fetch all live state and recompute the digest. Any changed payload, recipient, scope, version, or policy invalidates approval. Approvals are single-use. A digest is an integrity binding, not proof of identity or a digital signature; approvals must also be authenticated and actor-attributed.

Execution MUST use a narrow adapter, provider idempotency where available, bounded timeout/retry, and an explicit result state. Do not automatically retry non-idempotent external actions unless the provider confirms safe idempotency. Record provider reference and outcome. If outcome is unknown, mark `RECONCILIATION_REQUIRED`; do not blindly resend.

### 3.6 Connector gateway

Connectors are separate, reviewed adapters with:
- official OAuth authorization-code flow with PKCE where supported;
- encrypted server-side token storage, refresh rotation, revocation and disconnect;
- exact provider scopes and purpose disclosure before connection;
- per-owner/per-tenant credential isolation;
- webhook signature verification and replay protection;
- outbound destination allowlists, SSRF defenses, request/response size limits, and timeouts;
- rate limits, quotas, health status, provider policy/version tracking;
- contract tests and provider sandbox tests.

Initial connector order:
1. Public web search (existing planning capability; read-only).
2. Email draft creation, with send disabled until exact-approval execution exists.
3. Calendar read/create with explicit scope and confirmation.
4. File storage read with explicit folder/file scope.
5. Social publishing only after the provider's current official API permissions and app-review requirements are verified; do not promise personal Facebook profile posting where the API does not permit it.
6. Messaging/phone only after legal, provider, consent, recording, and identity rules are separately reviewed.

A phone number alone is not a connector. No covert call recording, account takeover, scraping behind login, or automated outreach without permission.

### 3.7 Audit and operations

Append correlated events for intent, plan, policy decision, grant reservation/consumption/release, approval request/decision/expiry, connector call, result, failure, cancellation, revocation, memory change, and disconnect. Store minimum necessary metadata; never log access tokens, passwords, raw secrets, or unnecessary private payloads. Audit records must be tenant-scoped, access-controlled, exportable under policy, and tamper-evident.

Provide owner kill switch (pause agent and cancel queued work), connector disconnect, grant revocation, and run cancellation. Revocation must block new execution immediately and cancel/release eligible queued or claimed work transactionally. Define and test a bounded revocation propagation objective.

## 4. Functional requirements

- DA-FR-001: Natural-language intent is converted to a typed intent; ambiguous target, recipient, or action triggers clarification rather than guessing.
- DA-FR-002: Owner persona is loaded only for the authenticated owner and never grants capabilities.
- DA-FR-003: Memory is typed, provenance-bearing, classified, expiring, correctable, and tenant-isolated.
- DA-FR-004: Inferred memory cannot authorize, disclose, or override confirmed preferences.
- DA-FR-005: Planner output is schema-validated and limited to server-allowlisted actions.
- DA-FR-006: Every step is checked against live grant, role, lifecycle, policy, target, data, connector, and quota.
- DA-FR-007: Grants are narrow, versioned, expiring, revocable, and cannot be self-issued by an agent.
- DA-FR-008: Approval is exact-payload, recipient-, scope-, version-, and expiry-bound, authenticated, one-time, and revalidated at execution.
- DA-FR-009: No R2/R3 external side effect occurs without its required approval.
- DA-FR-010: Executor supports idempotency, bounded retry, cancellation, reconciliation, and explicit outcome states.
- DA-FR-011: Connector credentials are encrypted and isolated; users can inspect scopes and disconnect.
- DA-FR-012: External content is untrusted and cannot alter prompts, grants, policy, or tool allowlists.
- DA-FR-013: Owner can review, correct, export, pause, revoke, and delete eligible memories and grants.
- DA-FR-014: Every consequential transition emits an attributable audit event.
- DA-FR-015: Arabic/English experiences explain permission, approval, failure, and action outcome in the user's language.
- DA-FR-016: Organization agents additionally enforce RBAC/ABAC and separation of requester/approver where required.
- DA-FR-017: No provider call occurs without explicit provider consent, configured data policy, and bounded spend controls.
- DA-FR-018: UI distinguishes proposal, pending approval, executing, completed, failed, and unknown/reconciliation states; never presents a plan as completed work.

## 5. Non-functional and security requirements

- Tenant isolation is enforced in data-access functions and database-backed tests, not only UI filters.
- Sensitive execution fails closed on policy, database, connector, or audit unavailability.
- Secrets are never returned to the client or written to logs.
- Request, plan, attachment, and response sizes are bounded.
- AI calls use data minimization, explicit consent, configured retention controls, moderation/safety checks appropriate to the domain, and provider-side hard spend limits.
- Worker claims use leases, bounded attempts, dead-letter handling, and deterministic concurrency controls.
- All writes use transactions where authorization, reservation, state transition, and audit must succeed together.
- Accessibility, responsive mobile layouts, Arabic RTL and English LTR are first-class.
- Performance targets (latency, throughput, RTO/RPO) remain measurable open decisions until workload and hosting evidence exist; do not invent SLOs.

## 6. Test and acceptance strategy

Tests MUST use fake providers by default. CI MUST never send real email, publish content, make purchases, place calls, or incur paid provider usage.

### Unit tests
1. Intent parser: Arabic/English equivalent requests, ambiguous recipient, missing target, conflicting constraints.
2. Memory: confirmed vs inferred vs task context; provenance; expiry; correction; deletion; no sensitive-trait inference.
3. Context builder: least-data selection, classification filtering, tenant boundaries, provider disclosure denial.
4. Plan validator: unknown action, extra fields, malformed schema, cyclic dependency, excessive depth/steps, untrusted tool name.
5. Risk classifier: each tier, escalation on uncertainty, domain prohibition.
6. Policy engine: grant intersection, scope mismatch, expired/revoked grant, role downgrade, wrong tenant, wrong region, stale version, provider-scope mismatch.
7. Approval digest: canonicalization stability; payload/recipient/attachment/amount/scope/version tampering; expiry; nonce replay; actor separation.
8. Executor: idempotency, timeout, retry ceiling, cancellation, unknown provider outcome, compensation and reconciliation.
9. Connector token service: encryption boundary, refresh rotation, disconnect, no secret serialization/logging.
10. Audit: required events, actor attribution, transaction rollback if audit write fails, redaction.

### PostgreSQL integration tests
1. Cross-user and cross-tenant access denied for memory, credentials, grants, approvals, runs, and audit.
2. Concurrent attempts cannot exceed grant uses, active run limits, or one-time approval consumption.
3. Grant revocation during queued, claimed, approval-waiting, and executing states blocks subsequent side effects and releases reservations safely.
4. Owner pause/revoke and organization membership/role downgrade cancel dependent runs.
5. Approval replay, altered payload, altered recipient, expired approval, and changed policy/grant version all fail.
6. Two workers cannot execute the same step; expired lease recovery does not duplicate provider side effects.
7. Connector disconnect/revocation prevents refresh and subsequent calls.
8. An audit failure rolls back the state transition that requires its audit record.
9. Memory correction/deletion is isolated to the owning user and obeys retention/cascade rules.
10. Unknown or unavailable policy state fails closed.

### Contract and adapter tests
- Validate each provider adapter against a versioned contract.
- Verify OAuth state/PKCE, exact scopes, callback origin, token refresh, revocation, webhook signature, replay rejection, timeout and rate-limit handling.
- Assert that unsupported provider operations are rejected rather than silently emulated.
- Use provider sandboxes only when available and separately approved; CI uses deterministic fakes.

### Playwright end-to-end tests
1. Owner sets persona and sees it persisted across authenticated sessions.
2. Agent explains what it knows, identifies source/confidence, and accepts a correction.
3. Owner creates a narrow grant and sees action/target/data/expiry/limits before confirming.
4. Public search runs under a valid grant and displays source-linked claims with uncertainty.
5. A send/publish action creates a preview and approval request but sends nothing before approval.
6. Owner edits recipient/content after preview; previous approval becomes invalid.
7. Owner approves exact payload; fake adapter records one execution and UI shows the real result.
8. Expired/revoked grant, disconnected connector, wrong tenant, or missing consent prevents execution.
9. Owner pauses agent and queued work is visibly cancelled.
10. Arabic RTL and English LTR cover permission, approval, errors, and audit views on mobile and desktop.
11. UI never labels proposed or unknown actions as completed.
12. Keyboard and screen-reader accessible approval controls.

### Security and resilience tests
- Prompt injection in webpages, emails, attachments, and tool outputs cannot add tools, expose private data, or change grants.
- SSRF attempts (loopback, private IP, link-local, DNS rebinding, redirect chains, unusual schemes) are rejected by connector fetch boundaries.
- IDOR, CSRF, session fixation, OAuth state confusion, callback mix-up, webhook replay, rate-limit bypass, and request-body abuse are tested.
- Property/fuzz tests cover payload canonicalization, policy inputs, schema validation, and state transitions.
- Fault injection covers database outage, queue delay, worker crash, provider timeout, duplicate webhook, partial provider success, and audit sink failure.
- Independent threat review and penetration test are required before public production execution.

## 7. Delivery sequence and gates

### Phase A — Understanding and memory (no external side effects)
- Extend the existing UserPersona carefully.
- Add memory schema/service, context builder, provenance and owner controls.
- Add intent classification and plan contracts.
- Gate: memory and context unit/integration tests pass; no grant or execution behavior is inferred from memory.

### Phase B — Delegation and approvals (still no external side effects)
- Unify grant scope evaluation with action plans.
- Bind approval to canonical exact action payload and all relevant versions.
- Add approval inbox, owner kill switch, audit correlation and concurrency tests.
- Gate: replay/tampering/revocation/tenant integration tests pass.

### Phase C — First execution adapter (controlled, reversible)
- Introduce a server-side execution gateway and one low-risk adapter in test/sandbox mode.
- Keep send/publish/payment/sign/account mutation disabled.
- Prove idempotency, reconciliation, revocation, and audit under fault injection.
- Gate: security review and explicit owner approval for enabling a staging connector.

### Phase D — Owner-approved external actions
- Add one connector at a time after provider API/policy review.
- Begin with draft-only; enable send/publish only after exact approval and adapter contract tests.
- Gate: sandbox/staging evidence, cost limits, operational alerts, incident and rollback runbooks.

### Phase E — Organization delegation
- Add organization-specific approval separation, role constraints, audit access, offboarding and delegated-administrator tests.
- Gate: full RBAC/ABAC and tenant isolation review.

No phase implies production readiness. Deployment, real credentials, paid APIs, provider app review, production migrations, or real external side effects require separate explicit authorization.

## 8. Current implementation baseline (evidence-based)

At the time of this specification, the existing project work provides a foundation:
- authenticated personal workspace connected to persisted, tenant-scoped agent runs on the active feature branch;
- owner persona persistence (display name, tone, goal);
- agent lifecycle, capability declarations, field disclosure policies, permission grants, audit records, and approval request records in the Prisma model;
- PostgreSQL-backed run queue/worker planning, leases/retries, grant reservations, cancellation/revocation paths, and provider-consent gates;
- current planner is a **proposal/planning system**, not an action executor.

Not yet established as implemented by this baseline:
- general typed personal memory and knowledge graph;
- live OAuth connectors for email, calendar, storage, social, messaging, or telephony;
- deterministic side-effect executor and provider adapters;
- exact-payload approval-to-execution transaction end-to-end;
- operational staging evidence for real external actions.

These are explicit implementation gaps, not implied capabilities. Do not advertise them as available until their acceptance tests pass.

## 9. Review triggers

Revisit this decision when adding a new action class, provider, region, sensitive data class, organization delegation model, or when law/provider terms change; after any unauthorized action or data disclosure; and before enabling any real external execution.
