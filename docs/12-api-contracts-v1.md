# API Contracts — v1 Foundation

- Document ID: TAN-API-001
- Version: 1.0.0
- Status: Initial contract; OpenAPI generation and contract tests pending
- Base path: /api/v1 for domain APIs; /api/auth for Better Auth endpoints

## 1. Contract rules

- JSON over HTTPS.
- All request bodies and query parameters are runtime-validated.
- All authenticated responses are non-cacheable unless explicitly public.
- Error responses use stable machine-readable codes.
- Every mutating request accepts or receives a correlation ID.
- Tenant/owner identifiers in a request are hints only; authorization derives from the authenticated principal and server-side membership.
- Breaking changes require a new major API version.

## 2. Standard error envelope

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "The request could not be validated.",
    "correlationId": "opaque-correlation-id",
    "details": {}
  }
}
```

Do not expose stack traces, SQL errors, secrets, internal prompts, or sensitive policy details. The current helper emits this envelope for domain API errors.

## 3. Initial endpoints

| Method | Path | Auth | Purpose | Status |
|---|---|---|---|---|
| GET | /api/health/live | No | Process liveness | Implemented |
| GET | /api/health/ready | No | Database readiness | Implemented |
| GET | /api/v1/agents | Yes | List personal agents owned by current user | Implemented |
| POST | /api/v1/agents | Yes | Create a private draft personal agent | Implemented |
| GET | /api/v1/organizations | Yes | List organizations where current user is a member | Implemented |
| POST | /api/v1/organizations | Yes | Create organization and assign creator as OWNER | Implemented |
| GET/POST | /api/v1/organizations/{organizationId}/agents | Yes | List/create organization-owned agents with role checks | Implemented |
| GET/POST | /api/v1/agents/{agentId}/grants | Yes | List/create scoped, expiring grants | Implemented; execution disabled |
| POST | /api/v1/agents/{agentId}/grants/{grantId}/revoke | Yes | Revoke an active grant | Implemented |
| GET/POST | /api/v1/agents/{agentId}/field-policies | Yes | Read/update field-level disclosure policies | Implemented; outbound enforcement pending |
| GET/POST | /api/auth/* | Auth-specific | Sign-in/session and invitation-gated signup | Mounted |
| POST | /api/admin/invitations | Platform admin | Issue a single-use invitation; token returned once | Implemented |

The canonical agent routes are under /api/v1. A temporary /api/agents alias remains during the initial build; no public API compatibility promise has been made yet.

## 4. Create agent

Request:

```json
{
  "name": "Personal Research Agent",
  "purpose": "Find relevant public information and summarize sources.",
  "publicDescription": "An owner-controlled research assistant.",
  "primaryLanguage": "en"
}
```

Rules:
- name: 2–80 characters.
- purpose: 10–500 characters.
- publicDescription: optional, max 500 characters.
- primaryLanguage: ar or en; defaults to ar.
- discoverable is always false on creation.
- status is always DRAFT on creation.
- owner identity is derived from the authenticated session, never request JSON.
- conservative field disclosure policies are created in the same transaction.

Response: 201 with the created agent and correlationId.

## 5. Organization ownership

- Organization creation creates an OWNER membership for the authenticated user in the same transaction.
- Organization agent reads require membership.
- Organization agent creation requires OWNER, ADMIN, or AGENT_MANAGER.
- Agent ownership is stored against the organization, not the employee who created it.
- Organization member invitation, role changes, offboarding, and ownership transfer are not implemented yet.

## 6. Grants and disclosure policies

- Grant creation requires agent management authority.
- Grants are scoped to declared actions, targets, data scopes, expiry, and optional use limits.
- Wildcard targets are rejected.
- Revocation is conditional and increments the grant version.
- No action runner consumes grants yet; API responses explicitly state execution is disabled.
- Field policies classify the initial agent fields and prevent non-PUBLIC fields from being marked publicly visible.
- No outbound disclosure pipeline consumes these policies yet; do not interpret stored policy records as proof of enforcement in a live discovery or messaging flow.

## 7. Required future contracts before activation

- Invitation issue, reserve, redeem, revoke, and expiry lifecycle for organization membership.
- Field disclosure preview and policy evaluation at every outbound boundary.
- Approval request, owner decision, one-time execution, and replay rejection.
- Discovery query, candidate, source, claim, and evidence.
- Agent-to-agent messaging and abuse controls.
- Verification submission and scoped verification result.
- Data export, correction, and deletion request.

No future endpoint may be considered implemented because it appears in this list.
