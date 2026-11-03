# Action approval workflow

## Current behavior

The approval workflow records a human decision for a specific proposed action. It does not execute the action.

An approval request is bound to:
- agent and active permission grant
- action type and exact recipient
- requested data scopes
- SHA-256 digest of canonical JSON payload
- requester identity, expiry, and idempotency key

The stored human-readable preview redacts credential-like keys and bounds nesting, arrays, and string length. The raw action payload is not stored. A future executor must supply the exact payload again and verify the stored digest before any execution. Requests are currently limited to organization-owned agents so a separate OWNER/ADMIN approver can review them; personal-agent approvals are not enabled.

Only an organization OWNER or ADMIN can approve or reject. The requester cannot approve their own request. The decision transaction rechecks the grant, scopes, expiry, approval digest, status, and version. Revoked or exhausted grants cancel pending requests.

## State transitions

- PENDING -> APPROVED
- PENDING -> REJECTED
- PENDING -> EXPIRED
- PENDING -> CANCELLED

APPROVED is not executable in this release. The CONSUMED state is reserved for a future execution workflow and is not reachable through the current API.

## Cryptographic boundary

The payload and envelope digests use canonical JSON and SHA-256. They detect accidental or partial mutation and bind the recorded decision to the submitted request. They are not keyed signatures and do not protect against an attacker who can rewrite the database and recompute both digests. A production execution system will need a managed signing key or equivalent tamper-resistant approval attestation.

## Schema and release boundary

The additive Prisma model is currently proposed on a draft feature branch. The repository's current CI workflow uses Prisma schema synchronization; no production database has been changed. Before production adoption, create and review a formal PostgreSQL migration, take a verified backup, test restore and rollback on a staging copy, and only then schedule a separately approved deployment.

No external action execution, messaging, or tool invocation is enabled by this workflow.
