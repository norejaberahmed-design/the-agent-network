# Implementation Baseline — The Agent Network

- Document ID: TAN-IMPL-BASE-001
- Version: 1.0.0
- Status: Proposed implementation baseline; runtime validation pending
- Branch: build/platform-foundation-v1

## Purpose

Translate the approved product direction into a buildable, reviewable first platform foundation without changing the approved product decisions. This document records implementation choices so they are explicit and reversible.

## Initial architecture

Use a modular monolith with strict module boundaries. The first deployment is one web application and one relational database. Background work initially uses durable database-backed jobs/outbox records; introduce a separate broker only after measured throughput or isolation needs justify it.

### Selected implementation baseline

| Concern | Baseline | Constraint |
|---|---|---|
| Web application | Next.js App Router, React, TypeScript | Responsive, Arabic RTL and English LTR |
| API | Versioned Next.js route handlers | Runtime validation; server-side authorization |
| Database | PostgreSQL | Authoritative transactional store |
| ORM/migrations | Prisma | Reviewed forward-only migrations; never reset production |
| Authentication | Better Auth with database adapter | Invite-only application policy; no public signup |
| Validation | Zod | Parse every external request and provider response |
| Tests | Vitest + Playwright | Unit, integration, contract, and browser tests |
| Local development | Node.js LTS + PostgreSQL via Docker Compose | No paid service required for local work |
| AI/search | Provider interfaces only | No provider credentials or paid calls in baseline |
| Jobs | Transactional outbox + database-backed worker | Idempotency, bounded retries, cancellation |
| Deployment | Container-compatible web process | Provider/region selection remains an explicit later decision |

Versions must be pinned by the lockfile after dependency installation and security review. The table is a starting decision, not a claim that packages have been installed or tested.

## Architecture decisions recorded for implementation

- **IMPL-001 — Modular monolith:** keep domain modules separate in one deployable application until evidence supports extraction.
- **IMPL-002 — PostgreSQL system of record:** all ownership, grants, approvals, tenant boundaries, and audit references are relationally enforced.
- **IMPL-003 — Server-authoritative policy:** UI state never grants access; every protected command rechecks membership, grant, disclosure, and risk policy on the server.
- **IMPL-004 — Invite-only access:** account creation is available only through a valid, single-use invitation. Public registration remains disabled.
- **IMPL-005 — No autonomous external execution in the first foundation:** agents can be configured and internal workflows exercised; external communication/tool adapters remain disabled until their security gates pass.
- **IMPL-006 — No AI provider dependency:** core domain behavior works without an AI API key. AI features are introduced behind interfaces with quotas and explicit data policies.
- **IMPL-007 — Durable audit and outbox:** material changes and queued work are committed transactionally with domain state.
- **IMPL-008 — No regional routing claims yet:** local development is not a regional production deployment. Region/provider selection requires legal, privacy, and operational review.

## First vertical slice

1. Health/readiness endpoint.
2. Invite-only authentication.
3. User profile and session.
4. Organization creation and membership roles.
5. Agent create, list, view, pause, and owner-only configuration.
6. Field-level disclosure policy records.
7. Permission grant create/revoke and audit trail.
8. Basic owner dashboard in Arabic and English.
9. Database migrations and deterministic seed for local development only.
10. CI checks for lint, typecheck, unit tests, migration validation, and build.

## Security invariants for implementation

- Tenant and owner scope are derived from the authenticated session and verified membership, never trusted from request body identifiers alone.
- Every database query involving tenant-owned records is scoped by owner/tenant authorization.
- Secrets and raw credentials never enter logs or source control.
- Invite tokens are high-entropy, stored hashed, expiring, single-use, and bound to an intended email or explicit invitation policy.
- Permission grants are scoped, versioned, expiring, and revocable.
- Approval records bind to an immutable action payload digest, recipient, grant version, expiry, and one-time use.
- No purchase, payment, signature, legal commitment, sensitive disclosure, or external action is enabled in this initial slice.
- External content is untrusted data and cannot alter policy or invoke tools.
- Audit records contain minimal metadata and references, not unnecessary private payloads.

## Definition of implementation completion

A capability is complete only when its schema/migration, server-side command/query, authorization checks, validation, user interface, audit behavior, automated tests, and operational notes are present. A rendered page or successful typecheck alone is insufficient.

## Explicitly not claimed

This baseline does not establish production readiness, security certification, legal compliance, regional residency, customer demand, funding, or partnership. Runtime validation requires dependency installation, a live PostgreSQL instance, migrations, test execution, and deployment verification.
