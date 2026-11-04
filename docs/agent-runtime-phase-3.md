# Agent Runtime — Phase 3: Leased worker and AI plan generation

Status: implemented as a server-side planning worker. It does not execute plan steps.

## Worker entry point

- Internal endpoint: POST /api/internal/agent-worker
- Authentication: Authorization: Bearer <AGENT_WORKER_SECRET>, compared in constant time.
- One invocation claims and processes at most one run, and also purges expired run records.
- The repository includes an opt-in GitHub Actions scheduler (`.github/workflows/agent-worker.yml`) that invokes one worker iteration hourly and can also be started manually. It remains inert until the operator adds `APP_URL` and `AGENT_WORKER_SECRET` as repository secrets after deployment. Scheduled workflows run from the default branch, so this workflow becomes active only after its reviewed PR is merged. Do not call the endpoint from browser code. Keep the secret in the scheduler secret store, never in a URL or client bundle.
- The endpoint is disabled unless AGENT_WORKER_SECRET, OPENAI_API_KEY, and OPENAI_AGENT_MODEL are configured.

## Required environment

- DATABASE_URL — PostgreSQL connection string.
- AGENT_WORKER_SECRET — long random secret used only by the scheduler.
- OPENAI_API_KEY — server-only API key; never expose it to the browser or commit it.
- OPENAI_AGENT_MODEL — explicit model name enabled for the API project.
- OPENAI_AGENT_MAX_DAILY_RUNS — global rolling 24-hour ceiling; defaults to 20, 0 disables processing, maximum accepted value is 1000.

No key or secret is stored in this repository. CI uses fake providers and does not call OpenAI.

## Worker guarantees

- Run tasks, plans, and source metadata expire after 30 days. The trusted worker invocation deletes expired records, cascades plan steps, and releases any still-reserved grant uses before deletion. Keep the scheduler running even when provider configuration is disabled so retention continues.

- Queue, worker, grant, lifecycle, retention and cancellation transitions acquire a dedicated per-agent row lock (`Agent.runtimeLockVersion`) first, then lock grant rows in deterministic order. Claims use a conditional status/attempt update, so only one worker can own a lease.
- Each claim has a 90-second lease. Expired leases can be reclaimed.
- Attempts are bounded by maxAttempts. Exhausted leases and retries move to DEAD_LETTER.
- Agent lifecycle, configuration version, tenant membership, capability declarations, grant expiry, purpose, target, data scope, and reserved capacity are revalidated before provider use and again before plan persistence.
- Grant reservations are consumed atomically only after a validated plan is saved. Failures and cancellations release reservations.
- Grant revocation, owner cancellation, agent pause/suspension, and organization requester role downgrade/removal can stop QUEUED or PLANNING runs and release reservations. A provider response arriving after cancellation is discarded.
- Provider and moderation failures fail closed. Transient errors use bounded exponential backoff.
- Queue creation is capped at 10 requests per user per hour and 20 active QUEUED/PLANNING runs per agent. The worker also applies a global rolling 24-hour run ceiling. These are request-count guards, not monetary spending guarantees. Set a hard project spend limit in the provider account before enabling paid inference.

## OpenAI integration

- Uses the Responses API with strict JSON Schema output.
- Enables the hosted web_search tool only when SEARCH_PUBLIC_WEB is in the run's live, owner-approved action set, and caps built-in tool calls at one per run.
- Captures source URLs from the web_search_call.action.sources metadata; source links are restricted to HTTP(S), reject embedded credentials, drop fragments, and strip sensitive query parameters.
- Sends store=false and a SHA-256 hashed safety_identifier. Do not interpret store=false as Zero Data Retention: abuse-monitoring retention and account-level data controls still apply.
- Locally screens task input for likely child-sexual-abuse content and obvious credential formats before any provider call; it applies the same screening to generated plan text before sending that output to moderation. Eligible text is then moderated with omni-moderation-latest. Moderation failures stop processing. These local patterns are defense-in-depth, not complete PII or child-safety detection.
- A local precautionary screen runs before moderation so known or suspected child-sexual-abuse content is not sent to the moderation endpoint. This heuristic is not a complete child-safety system and is not sufficient by itself for a public launch.

## Human review and non-execution

- The dashboard requires explicit user consent before a task is queued for processing by the configured external AI provider; the consent version and timestamp are persisted. It warns users not to submit passwords, personal data, or secrets.
- Successful provider output is schema-validated against the live server-derived allowlist and stored as PROPOSED steps with source metadata.
- Owners can inspect the plan and reject it.
- No step executor exists in this phase. No message is sent, no payment is made, no signature is created, no account is changed, and no private data is disclosed.
- ActionApproval exact-payload approval remains a separate required gate before any future consequential action.

## Remaining public-launch gates

1. Add dedicated child-safety safeguards, abuse reporting, admin triage, and account enforcement before accepting arbitrary public user content.
2. Add production monitoring/alerting for worker latency, lease recovery, dead-letter growth, provider failures, and retention job health.
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
