# Agent Runtime — Phase 3: Worker lease protocol

Status: implemented and gated; no worker service has been deployed.

## Worker endpoints

All endpoints require `Authorization: Bearer <AGENT_WORKER_TOKEN>`. The token must be at least 32 characters and is read only from the runtime environment. Missing or invalid configuration fails closed.

- `POST /api/internal/agent-runs/claim` — body: `{"workerId":"worker-001"}`; atomically leases one eligible run.
- `POST /api/internal/agent-runs/heartbeat` — body: `{"runId":"...","workerId":"worker-001"}`; extends an unexpired lease owned by that worker.
- `POST /api/internal/agent-runs/fail` — body: `{"runId":"...","workerId":"worker-001","errorCode":"WORKER_FAILURE","retryable":true}`; retries with bounded exponential backoff or terminates the run.

Request bodies are bounded to 4 KiB. Worker identifiers and failure codes are validated. Responses are non-cacheable.

## Concurrency and recovery

- A PostgreSQL transaction-scoped advisory lock serializes state-changing operations per agent.
- Grant rows are locked in deterministic order before claim, cancellation, revocation, and terminal reservation release.
- Claim uses a compare-and-set transition from `QUEUED` to `CLAIMED`; a second worker cannot claim the same run.
- Claim rechecks agent lifecycle, persisted capabilities, grant ownership, purpose, target, public data scope, status, expiry, and reserved capacity.
- If the policy no longer permits the run, it is cancelled and all reservations are released.
- Heartbeats are accepted only from the current worker while its lease remains valid.
- Expired leases are requeued with bounded backoff; after the configured attempt ceiling they enter `DEAD_LETTER` and reservations are released.
- Pausing, suspending, or returning an agent to draft cancels queued/claimed runs and releases reservations.
- Revoking a grant cancels all queued/claimed runs that depend on it.

## Safety boundary

Claiming a run is not planning or execution. The claim API explicitly returns `planningEnabled: false` and `executionEnabled: false`. No model provider, external search, MCP/A2A tool, messaging, payment, signing, or other external side effect is called by this worker protocol.

## Operating requirements before enabling a worker

1. Set `AGENT_WORKER_TOKEN` through a secret manager; never commit it or return it to clients.
2. Run the worker in a private network/service with outbound egress denied until reviewed provider/tool adapters are enabled.
3. Add health monitoring, alerting, worker identity rotation, and operational dashboards.
4. Configure a scheduled lease-recovery invocation or ensure claim polling calls the reaper frequently enough.
5. Complete provider privacy minimization, budgets, timeouts, moderation, prompt-injection tests, exact-payload approvals, and end-to-end recovery before any side effect.
6. Rehearse database backup/restore and existing-database migration adoption before production deployment.

No worker was deployed, no secret was created, and no production database or deployment was changed.
