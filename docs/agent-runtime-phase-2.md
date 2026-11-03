# Agent Runtime — Phase 2: Persisted, permission-gated run queue

Status: implemented as a queueing boundary; execution remains disabled.

## Delivered

- PostgreSQL `AgentRun` persistence with bounded task, purpose, target, status, attempt ceiling, owner snapshot, request digest, and requester-scoped idempotency.
- Authenticated, tenant-scoped `GET/POST /api/v1/agents/:agentId/runs` endpoints.
- The server derives allowed runtime actions from persisted `AgentCapability` records and currently active, unexpired, purpose/target-matching `PermissionGrant` records. Client-supplied actions are not accepted.
- Creating an owner grant declares the corresponding capability. Revoking/expiring the grant still prevents new runs because live grants are rechecked.
- A grant reservation counter is updated with compare-and-set semantics in the same transaction as run creation, preventing concurrent queue requests from exceeding finite grant budgets.
- Request idempotency is bound to the agent ID and canonical request digest. Reusing a key with a different payload or another agent is a conflict.
- Queued runs can be cancelled by an authorized owner/organization manager; cancellation releases the reserved grant capacity transactionally.
- Queue and cancellation events are written to the tenant-scoped audit log.

## Current action mapping

- `DISCOVER_INTERNAL` + persisted `READ_PUBLIC_PROFILE` capability → `READ_PUBLIC_PROFILE`.
- `SEARCH_PUBLIC_WEB` + persisted `SEARCH_PUBLIC_WEB` capability → `SEARCH_PUBLIC_WEB`.
- Only the `PUBLIC_PROFILE` data scope is accepted by this queue boundary.
- Message sending, private/contextual disclosure, payments, signatures, account mutations, and external side effects are not queueable.

## Explicit non-capabilities

- A queued run is not an executed run.
- No worker, model provider, web-search tool, planner invocation, executor, or external side effect is enabled in this phase.
- API responses explicitly report `executionEnabled: false`.
- Reservations remain attached to queued runs until cancellation or a later reviewed worker transition consumes/releases them. Do not expose queueing as execution.

## Release gates

1. Add a worker lease/claim protocol with atomic claim, lease expiry recovery, retry ceiling, cancellation, and dead-letter handling.
2. Revalidate agent status, tenant membership, grant status/expiry/scope/reservation, and configuration version immediately before planning and every action.
3. Add provider adapters only after privacy minimization, budgets, timeouts, moderation, safety identifiers, and prompt-injection tests.
4. Persist validated plan steps and connect approval requests to exact payload digests.
5. Keep external execution disabled until approval, atomic grant consumption, idempotency, audit, and failure recovery pass end-to-end tests.
6. Establish and rehearse the database migration baseline for existing environments before production migration deployment. The additive migration in this phase is not a substitute for baselining a pre-existing schema.

No production database was migrated and no deployment was performed.
