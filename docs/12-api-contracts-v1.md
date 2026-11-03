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
| GET | /api/v1/agents | Yes | List agents owned by current user | Implemented |
| POST | /api/v1/agents | Yes | Create a private draft agent for current user | Implemented |\n| GET | /api/v1/organizations | Yes | List organizations where current user is a member | Implemented |\n| POST | /api/v1/organizations | Yes | Create organization and assign creator as OWNER | Implemented |\n| GET/POST | /api/v1/organizations/{organizationId}/agents | Yes | List/create organization-owned agents with role checks | Implemented |\n| GET/POST | /api/v1/agents/{agentId}/grants | Yes | List/create scoped, expiring grants | Implemented; execution disabled |\n| POST | /api/v1/agents/{agentId}/grants/{grantId}/revoke | Yes | Revoke an active grant | Implemented |\n| GET/POST | /api/v1/agents/{agentId}/field-policies | Yes | Read/update field-level disclosure policies | Implemented; outbound enforcement pending |
| GET/POST | /api/auth/* | Auth-specific | Sign-in/session and invitation-gated signup | Mounted |\n| POST | /api/admin/invitations | Platform admin | Issue a single-use invitation; token returned once | Implemented |

The canonical agent routes are /api/v1/agents. A temporary /api/agents alias remains for compatibility during the initial build; no public API compatibility promise has been made yet.

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

Response: 201 with the created agent and correlationId.

## 5. List agents

Returns only agents whose owner type is USER and user owner ID equals the authenticated user ID. Organization agents are not included until membership authorization is implemented.

## 6. Required future contracts before activation

- Organization and membership management.
- Invitation issue, reserve, redeem, revoke, and expiry.
- Field disclosure preview and policy evaluation.
- Permission grant issue, inspect, revoke, and version.
- Approval request, owner decision, one-time execution, and replay rejection.
- Discovery query, candidate, source, claim, and evidence.
- Agent-to-agent messaging and abuse controls.
- Verification submission and scoped verification result.
- Data export, correction, and deletion request.

No future endpoint may be considered implemented because it appears in this list.
