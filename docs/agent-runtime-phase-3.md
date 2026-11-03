# Agent Runtime — Phase 3: Leased worker and AI plan generation

Status: implemented as a server-side planning worker. It does not execute plan steps.

## Worker entry point

- Internal endpoint: POST /api/internal/agent-worker
- Authentication: Authorization: Bearer <AGENT_WORKER_SECRET>, compared in constant time.
- One invocation claims and processes at most one run.
- Schedule a trusted server-side cron invocation (for example, once per minute). Do not call this endpoint from browser code.
- The endpoint is disabled unless AGENT_WORKER_SECRET, OPENAI_API_KEY, and OPENAI_AGENT_MODEL are configured.

## Required environment

- DATABASE_URL — PostgreSQL connection string.
- AGENT_WORKER_SECRET — long random secret used only by the scheduler.
- OPENAI_API_KEY — server-only API key; never expose it to the browser or commit it.
- OPENAI_AGENT_MODEL — explicit model name enabled for the API project.
- OPENAI_AGENT_MAX_DAILY_RUNS — global rolling 24-hour ceiling; defaults to 20, 0 disables processing, maximum accepted value is 1000.

No key or secret is stored in this repository. CI uses fake providers and does not call OpenAI.

## Worker guarantees

- Atomic claim uses PostgreSQL row locking with SKIP LOCKED.
- Each claim has a 90-second lease. Expired leases can be reclaimed.
- Attempts are bounded by maxAttempts. Exhausted leases and retries move to DEAD_LETTER.
- Agent lifecycle, configuration version, tenant membership, capability declarations, grant expiry, purpose, target, data scope, and reserved capacity are revalidated before provider use and again before plan persistence.
- Grant reservations are consumed atomically only after a validated plan is saved. Failures and cancellations release reservations.
- Grant revocation and owner cancellation can stop QUEUED or PLANNING runs. A provider response arriving after cancellation is discarded.
- Provider and moderation failures fail closed. Transient errors use bounded exponential backoff.
- The global run ceiling is a request-count guard, not a monetary spending guarantee. Set a hard project spend limit in the provider account before enabling paid inference.

## OpenAI integration

- Uses the Responses API with strict JSON Schema output.
- Enables the hosted web_search tool only when SEARCH_PUBLIC_WEB is in the run's live, owner-approved action set.
- Captures source URLs from the web_search_call.action.sources metadata; source links are restricted to HTTP(S).
- Sends store=false and a SHA-256 hashed safety_identifier. Do not interpret store=false as Zero Data Retention: abuse-monitoring retention and account-level data controls still apply.
- Moderates eligible input and generated plan text with omni-moderation-latest. Moderation failures stop processing.
- A local precautionary screen runs before moderation so known or suspected child-sexual-abuse content is not sent to the moderation endpoint. This heuristic is not a complete child-safety system and is not sufficient by itself for a public launch.

## Human review and non-execution

- Successful provider output is schema-validated against the live server-derived allowlist and stored as PROPOSED steps with source metadata.
- Owners can inspect the plan and reject it.
- No step executor exists in this phase. No message is sent, no payment is made, no signature is created, no account is changed, and no private data is disclosed.
- ActionApproval exact-payload approval remains a separate required gate before any future consequential action.

## Remaining public-launch gates

1. Add dedicated child-safety safeguards, abuse reporting, admin triage, and account enforcement before accepting arbitrary public user content.
2. Add end-to-end tests for the internal worker route, concurrent claim races, grant revocation during provider execution, lease expiry, and cancellation.
3. Add provider spend alerts/hard limits and operational monitoring in the provider project.
4. Add a reviewed action executor only for explicitly supported actions, with exact-payload approvals, revalidation, atomic grant consumption, audit, idempotency, and rollback.
5. Configure secrets and a trusted scheduler in a deployment environment, then perform staging verification with explicit approval.

## Official references

- Responses API: https://developers.openai.com/api/reference/responses/overview
- Structured Outputs: https://developers.openai.com/api/docs/guides/structured-outputs
- Web search: https://developers.openai.com/api/docs/guides/tools-web-search
- Moderation: https://developers.openai.com/api/docs/guides/moderation
- Safety best practices: https://developers.openai.com/api/docs/guides/safety-best-practices
- Data controls: https://developers.openai.com/api/docs/guides/your-data
- Rate limits: https://developers.openai.com/api/docs/guides/rate-limits

No deployment or paid API call was performed.
