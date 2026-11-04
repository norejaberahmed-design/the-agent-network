# Digital Twin Agents — Reference Assessment

## Decision

Use the supplied `digital-twin-agents.zip` as a functional reference only. Do not copy its implementation or replace the existing application architecture.

The Agent Network remains on its existing Next.js 15, React 19, TypeScript, PostgreSQL, Prisma 6, Better Auth, persisted worker, tenant-governance, and audit architecture.

## Useful product patterns

The reference demonstrates five product concepts worth carrying forward:

1. A personal agent profile that represents its owner without claiming to be the human.
2. A discoverable directory of agents with capability-oriented matching.
3. Agent-to-agent negotiation that produces a structured proposal and transcript.
4. Explicit approval by each affected human before an agreement becomes binding.
5. A durable activity record for conversations, proposals, and decisions.

These are product requirements, not evidence that the reference implementation is production safe.

## Reuse map

| Reference concept | Existing Agent Network foundation | Required next capability |
|---|---|---|
| Digital identity | UserPersona, agent profile and owner-scoped memory | Compose a versioned representation snapshot for each delegated task |
| Agent directory | Agent records, lifecycle and discoverability controls | Search by declared capabilities, scope, language, and availability |
| Task delegation | AgentRun queue, planner, worker leases and grants | Persist delegation graph, child-task ownership, budgets, deadlines and cancellation propagation |
| Agent negotiation | Proposed AgentRun plans and source-linked claims | Structured offer/counter-offer protocol with provenance and bounded turns |
| Human agreement | ActionApproval and audit events | Bind each approval to exact offer terms, participants, expiry and policy version |
| Conversation history | AgentRun, steps and audit trail | Dedicated, tenant-scoped negotiation transcript with retention controls |
| External channels | No verified production connector in this phase | Official OAuth/API adapters, webhook signature validation, replay protection and revocation |

## Mandatory safety corrections to the reference

The supplied prototype uses a local JSON file, a development fallback secret, phone/password authentication, and an unauthenticated inbound-channel route. Its channel endpoint accepts caller-supplied sender/channel fields and must not be exposed as a real webhook without provider signature verification, replay protection, tenant binding, rate controls, and secret rotation.

Its negotiation loop also treats model-generated text as if it were a reliable offer. The production design must instead use typed, validated offer objects. Natural-language messages are explanatory only; they cannot silently alter price, quantity, delivery, legal terms, payment instructions, or authority.

The prototype's two-party approval flag is not sufficient for a durable agreement. Approval must bind to a canonical digest of the complete offer, both parties, expiry, and the policy/permission snapshot. Any change invalidates previous approvals and requires fresh approval. Agreement status must be monotonic and auditable; a rejected or expired offer cannot be reopened by overwriting a boolean.

## Target agent-to-agent lifecycle

`DISCOVER → MATCH → PROPOSE → NEGOTIATE → VALIDATE → REQUEST_APPROVAL → APPROVE/REJECT → RECORD`

- **DISCOVER:** Search only agents the caller is permitted to discover.
- **MATCH:** Score declared capabilities and verified profile fields; never infer authority from profile text.
- **PROPOSE:** Create a typed offer with explicit fields, provenance, expiry, and a stable digest.
- **NEGOTIATE:** Allow bounded counter-offers. Every counter-offer creates a new immutable version and digest.
- **VALIDATE:** Re-check both agents' lifecycle, tenant boundaries, grants, limits, and current policy.
- **REQUEST_APPROVAL:** Present the exact terms to every required human approver.
- **APPROVE/REJECT:** Record each decision against the exact digest. A changed offer requires new approvals.
- **RECORD:** Persist the final outcome and audit trail. This phase does not execute payments, messages, signatures, or external side effects.

## Personal memory and representation boundary

Personal memory remains owner-controlled. Confirmed facts, inferred observations, and task-scoped context must remain distinct. A model-generated inference is only a suggestion; it must not become a confirmed fact without owner review.

The owner's permission to store memory, permission to include memory in provider context, and permission to delegate an external action are three separate decisions. Consent to one must never imply the others.

For each delegated task, build a minimal, versioned representation snapshot from currently authorized identity and memory fields. Record which fields and versions informed the proposal. Do not copy private or highly sensitive memory into another agent's context.

## Phased implementation gates

### Phase 1 — Learning and memory review
- Extract only from explicitly consented, eligible task evidence.
- Persist suggestions with source run, evidence reference, confidence, expiry, and deduplication key.
- Support owner review: accept, edit, or reject.
- Rejection must suppress repeated identical suggestions.
- No automatic promotion to confirmed memory.

### Phase 2 — Agent directory and capability matching
- Tenant-aware visibility and owner-controlled discoverability.
- Search over declared capability metadata, not arbitrary private profile content.
- Tests for cross-tenant enumeration and revoked/paused agents.

### Phase 3 — Typed negotiation
- Immutable offer/counter-offer versions.
- Strict schema validation, bounded turns, idempotency, deadlines, and cancellation.
- No side effects; all outputs remain proposals.

### Phase 4 — Approval binding
- Exact offer digest, participants, approver identity, expiry, policy version, and revalidation at decision time.
- Any changed term invalidates prior approval.
- Append-only decision history.

### Phase 5 — Official connectors and execution
- Separate adapter contracts for each provider.
- OAuth/API scopes, signed webhooks, replay protection, secret rotation, rate limits, and disconnect/revocation.
- A separately reviewed executor with risk tiers, budgets, idempotency, and kill switch.
- No connector or execution is enabled merely because a channel name appears in a request.

## Non-goals of this assessment

This document does not add database models, enable external integrations, execute tasks, send messages, make purchases, sign agreements, change production configuration, migrate production data, merge pull requests, or deploy services.

## Acceptance principles

- Preserve the existing application and architecture.
- Keep tenant isolation and least privilege as server-enforced rules.
- Treat model output and user-editable profile text as untrusted data.
- Require explicit, revocable consent for each distinct data-use purpose.
- Keep every consequential decision attributable, reviewable, and reversible where technically possible.
- Do not describe the product as production-ready until security, integration, recovery, and end-to-end acceptance gates pass.
