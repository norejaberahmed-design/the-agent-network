# Security and implementation control matrix

Last reviewed: 2026-11-03

This matrix describes the proposed stacked pull requests for the current foundation branch. Draft PRs are not part of the default branch until reviewed and merged. A passing CI run is evidence for the tested scope only; it is not a production security certification.

## Verified in the current proposed stack

| Control | Evidence | Boundary |
|---|---|---|
| Request body size guard | PR #2 | Bounds JSON mutation bodies; not a substitute for infrastructure-level limits |
| Tenant access checks | PRs #3, #5, #6, #7 | Unit and PostgreSQL integration coverage for tested agent, organization, policy, and grant routes |
| Atomic grant-use consumption | PR #4 | Prevents maxUses overspend under concurrent consumption |
| PostgreSQL tenant isolation | PR #5 | Cross-tenant access cases exercised against PostgreSQL |
| Invitation reservation/redemption | PRs #8, #9 | Single-use reservation, expiry, email binding, and concurrent redemption coverage |
| Grant consumption/revocation race | PR #10 | Tests the grant's conditional state transition and audit evidence |
| Invitation token URL hygiene | PR #11 | Clears the one-time fragment after the accept page reads it |
| Organization member administration | PR #12 | Owner/admin role boundaries, scoped invitations, offboarding, and delegated invitation/grant revocation |
| Field disclosure policy primitive | PR #13 | Fail-closed projection for missing/ambiguous policy, audience/purpose rules, and highly sensitive fields |
| Owner disclosure preview | PR #14 | Authenticated preview using the same projection function |
| Local agent discovery | PR #15 | Authenticated directory; only active, discoverable agents and policy-approved fields |
| Agent lifecycle publishing | PR #16 | Owner/admin-only activation, public-profile prerequisite, audit event, and terminal revoked state |
| Organization audit log | PR #17 | Owner/admin/auditor read access and action-specific metadata redaction |

## Not yet implemented or not yet proven

- Exact-payload human approval, expiry, replay protection, and approval revocation.
- External action execution and post-execution verification.
- Full outbound disclosure enforcement at every adapter, tool, message, and model boundary.
- Public unauthenticated discovery, external search providers, and distributed rate limiting.
- Agent-to-agent messaging and external A2A/MCP integrations.
- Tamper-evident or append-only audit storage, retention policy, and independent audit export.
- Production secrets management, deployment hardening, backup/restore drills, regional data residency, and incident response.
- Independent penetration testing and a full threat-model review against the deployed environment.

## Release rule

Do not enable external execution, public unauthenticated discovery, or production publication until the missing controls above have been designed, implemented, tested, and reviewed. No schema migration, production data mutation, PR merge, or deployment is authorized by this document.
