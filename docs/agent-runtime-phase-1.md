# Agent Runtime — Phase 1: Safe Planning Boundary

Status: implementation slice; not an execution engine.

## Scope

This phase adds a provider-neutral planning contract. A model provider can return an untrusted proposed plan; the application validates its shape, bounded size, unique step identifiers, and each proposed action against a server-derived capability allowlist.

External pages, documents, and messages are passed in a separate `untrustedSources` field. They are evidence/data and must never be treated as policy or authorization instructions.

## Explicit non-capabilities

This phase does not:
- call an LLM provider or require an API key;
- execute tools, browse the web, send messages, spend money, sign, or modify owner data;
- grant capabilities or derive permissions from model output;
- treat a plan as an approval;
- replace the separate human approval and grant-consumption controls.

## Accepted plan actions

- `READ_PUBLIC_PROFILE`
- `SEARCH_PUBLIC_WEB`
- `DRAFT_MESSAGE`
- `ASK_OWNER`

The schema intentionally has no direct `SEND_MESSAGE`, payment, signature, account mutation, or private-data export action.

## Next acceptance gates

1. Bind allowed actions to persisted agent capabilities and live grants on the server.
2. Add an authenticated, tenant-scoped run creation API with idempotency and audit.
3. Persist run state and bounded step state with formal PostgreSQL migration and rollback.
4. Add a worker lease/claim protocol, retry ceiling, cancellation, and dead-letter handling.
5. Add provider adapters only after data minimization, budgets, timeouts, prompt-injection tests, and provider configuration are reviewed.
6. Keep external execution disabled until an independently reviewed executor revalidates owner, grant, approval digest, recipient, and exact payload immediately before the side effect.

No production database changes or external actions are part of this phase.


## CI verification branch
This branch exists only to run the repository's push-triggered validation workflow against the Phase 1 planning implementation. It is not a release branch.
