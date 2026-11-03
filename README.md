# The Agent Network

**Your identity. Your agent. Your world.**

The Agent Network is a proposed global, interoperable network in which people and organizations can own digital agents that represent their explicitly configured interests, capabilities, needs, and goals. Agents can discover other agents and public information, evaluate evidence, and coordinate conversations or workflows within owner-defined permissions.

This repository is the engineering and product source of truth. Requirements, security boundaries, data governance, interoperability contracts, and validation gates precede implementation.

## Non-negotiable product principles

1. **Owner control:** an agent never owns the person, organization, account, or data it represents.
2. **Least privilege:** every action is bounded by an explicit, scoped, revocable grant.
3. **Human approval for consequential actions:** no purchase, payment, signature, binding commitment, sensitive disclosure, or legally consequential action without a separate, informed approval for that exact action.
4. **Privacy by design:** each field has a classification, purpose, audience, retention rule, and disclosure policy.
5. **Evidence before claims:** discovery results distinguish verified facts, sourced claims, uncertain information, conflicts, and stale evidence.
6. **Interoperability:** use open standards where fit is demonstrated; do not create proprietary protocols without a documented need.
7. **Global by design, regionally governed:** regional data handling and cross-border transfers are explicit policy decisions, not accidental replication.
8. **Safe failure:** uncertainty, expired permissions, unavailable policy services, or integrity failures must fail closed for sensitive actions.
9. **No dark autonomy:** external messages and retrieved content are untrusted data, never authority to change an agent's instructions or permissions.
10. **Evolution without avoidable rewrites:** versioned contracts, migration discipline, architecture decision records, and backward-compatibility tests.

## Product direction

- Global network for individual and organization-owned agents.
- Invitation-based global alpha, followed by controlled expansion and eventual public registration.
- Arabic and English from the beginning.
- Responsive web experience for mobile and desktop.
- Owner-authorized discovery and communication; approval required for consequential actions.
- Owner-controlled field-level disclosure.
- Tiered, scope-specific verification.
- Hybrid discovery registry.
- Regional data governance, subject to legal and operational validation.

## Repository map

- `docs/00-project-charter.md` — mission, principles, scope, and governance.
- `docs/01-product-requirements.md` — actors, journeys, functional requirements, and acceptance criteria.
- `docs/02-system-architecture.md` — logical architecture, trust boundaries, and deployment model.
- `docs/03-security-privacy-trust.md` — threat model, authorization, approvals, privacy, and trust.
- `docs/04-data-governance.md` — data classification, lifecycle, residency, retention, and audit.
- `docs/05-interoperability.md` — standards strategy and integration boundaries.
- `docs/06-delivery-quality.md` — engineering controls, testing, release, operations, and stage gates.
- `docs/07-commercial-validation.md` — market hypotheses, validation plan, and enterprise-readiness evidence.
- `docs/08-open-decisions-register.md` — decisions, owners, evidence, and unresolved questions.
- `docs/09-risk-register.md` — product, technical, legal, security, and commercial risks.
- `docs/10-implementation-baseline.md` — initial implementation choices and first vertical slice.
- `docs/11-initial-data-model.md` — initial relational model and integrity requirements.
- `docs/12-api-contracts-v1.md` — first API contracts and activation status.
- `docs/ar/overview.md` — Arabic project overview.

## Implementation status

The `build/platform-foundation-v1` branch contains an initial application scaffold:
- Next.js App Router + TypeScript.
- PostgreSQL + Prisma data model.
- Better Auth email/password sign-in with invitation-gated account creation and a one-time first-admin bootstrap.
- Single-use, expiring invitation issuance and redemption, restricted to platform administrators.\n- Single-use, expiring invitation issuance and redemption, restricted to platform administrators.\n- Health liveness/readiness endpoints.
- Authenticated personal-agent and organization-owned agent create/list APIs with membership role checks.\n- Organization creation with owner membership.\n- Agent governance page with scoped grant creation, listing, and revocation; grants are stored but cannot execute actions yet.
- Arabic-first landing page, sign-in page, and owner dashboard.
- Initial agent input validation tests and CI workflow.

**This is an implementation starting point, not a completed or production-ready network.** Invitation issuance/redemption, organization member invitations/role administration, field-level disclosure enforcement, grant lifecycle, approval protocol, discovery, evidence, messaging, external A2A/MCP integrations, regional deployment, and operational security controls remain to be built and tested.

No production deployment, security certification, legal compliance assessment, customer commitment, market demand, funding, or partnership is claimed. A code file is not considered complete until it is installed, typechecked, tested, and exercised against a real database.

## Working rules

- No destructive database operations or irreversible repository changes without explicit approval.
- No secrets, personal data, customer records, or sensitive evidence in source control.
- No paid infrastructure, APIs, or external outreach without explicit approval.
- Every material architectural decision receives an Architecture Decision Record.
- Every release must pass its defined acceptance, security, privacy, and rollback gates.
- Changes to approved product decisions require an explicit decision record and owner approval.
- Do not merge the build branch into `main` without explicit approval.

## Local development

Requirements: Node.js 22+, npm, Docker Compose.

1. Copy `.env.example` to `.env` and set a unique `BETTER_AUTH_SECRET` (at least 32 characters).
2. Start PostgreSQL with `docker compose up -d postgres`.
3. Install dependencies with `npm install`.
4. Generate Prisma Client with `npm run db:generate`.
5. Review and create the first migration with `npm run db:migrate`.
6. Start the app with `npm run dev`.

Do not use `prisma db push` or `prisma migrate reset` against shared or production data. The initial schema still requires a reviewed migration with database-level ownership constraints before production use.
