# Initial Data Model & Integrity Invariants

- Document ID: TAN-DATA-MODEL-001
- Version: 1.0.0
- Status: Initial implementation schema; database migration and independent review pending

## 1. Authority boundaries

PostgreSQL is the authoritative store for account identity, ownership, memberships, agent configuration, grants, invitations, and audit metadata. Search indexes, model context, caches, and queues are derived systems and must never become authorization authorities.

## 2. Initial aggregates

| Aggregate | Records | Owner / boundary |
|---|---|---|
| Identity | User, Session, Account, Verification | Account principal |
| Organization | Organization, Membership, Invitation | Organization tenant |
| Agent | Agent, AgentCapability, AgentFieldPolicy | Exactly one user or organization owner |
| Authorization | PermissionGrant | One agent; bounded scope |
| Accountability | AuditEvent | Actor + represented owner + correlation |
| Future discovery | Source, Evidence, Claim, Candidate | Evidence provenance and source lifecycle |
| Future coordination | Conversation, Participant, Message | Explicit participant and disclosure policies |
| Future approval | ApprovalRequest, ApprovalDecision | Exact payload, recipient, grant version |

The current Prisma schema implements Identity, Organization/Membership, Agent, PermissionGrant, Invitation, and AuditEvent foundations. Discovery, evidence, coordination, and approval aggregates are deliberately not exposed as active product features yet.

## 3. Required database invariants

The following must be enforced in the database migration, not only in TypeScript:

1. Agent ownership is exclusive:
   - owner type USER: userOwnerId is non-null and organizationOwnerId is null.
   - owner type ORGANIZATION: organizationOwnerId is non-null and userOwnerId is null.
2. A grant's use count cannot be negative and cannot exceed maxUses when maxUses is set.
3. Invitation redemption is single-use and state transitions are conditional.
4. Membership uniqueness is per organization/user.
5. Field policy uniqueness is per agent/field key.
6. Capability uniqueness is per agent/capability key.
7. Audit event IDs and correlation IDs are immutable after insertion at the application layer; updates/deletes are not exposed to normal application roles.
8. A suspended/revoked agent cannot receive new grants or outbound actions.
9. Tenant-owned reads and writes must include an owner/tenant scope.
10. Deletion behavior must not cascade away legal/audit evidence required by retention policy.

## 4. Application transaction boundaries

- Agent creation and its audit event commit in one database transaction.
- Grant creation/revocation and its audit event commit in one transaction.
- Invitation reservation/redemption and membership creation must be concurrency-safe and atomic.
- A future external action uses an outbox record written in the same transaction as its approved state transition; the worker revalidates authorization immediately before dispatch.
- Never call an external provider inside a database transaction.

## 5. Required indexes and query constraints

- Agent lists: owner type + owner ID + creation time.
- Discoverable registry: active status + discoverable flag; only public, owner-approved fields are indexed.
- Grants: agent + status + expiry.
- Invitations: token hash unique; status + expiry; intended email lookup.
- Audit: owner + occurred time; agent + occurred time; correlation ID.
- Messages (when implemented): conversation + sequence/time; recipient delivery state.

## 6. Migration policy

- Generate migrations from the reviewed Prisma schema.
- Add SQL CHECK constraints and database permissions where Prisma schema cannot express the invariant.
- Review generated SQL before applying it.
- Use expand-migrate-contract for changes to populated tables.
- Never use db push or reset against shared/production data.
- A migration is not accepted until migrate-from-empty, upgrade-from-previous, backup, restore, and rollback/forward-recovery tests are recorded.

## 7. Known limitations of the first schema

- Regional data-plane placement is not implemented.
- Organization role enforcement currently covers membership-scoped agent listing and creation for OWNER, ADMIN, and AGENT_MANAGER; invitations, role changes, offboarding, and ownership transfer remain pending.
- Personal and organization-owned agent creation/listing are implemented. New agents receive conservative default field policies.
- Invitation issuance and single-use redemption are implemented with hashed tokens and a short-lived reservation state; concurrency, failure-recovery, and abuse tests remain pending.
- Approval requests and exact-payload approval are not yet implemented.\n- Field-policy CRUD is implemented for the initial agent fields, but no outbound disclosure pipeline consumes these policies yet.
- Append-only audit immutability requires database-level controls and operational separation beyond the initial ORM model.
