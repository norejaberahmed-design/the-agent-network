# OpenAI safety and platform-alignment baseline

Status: engineering baseline for The Agent Network. This is not an OpenAI certification, legal opinion, or claim that OpenAI has reviewed or approved this product.

## Policy sources and dates

- OpenAI Usage Policies: https://openai.com/policies/usage-policies/
- OpenAI API Safety Best Practices: https://developers.openai.com/api/docs/guides/safety-best-practices
- OpenAI Agents SDK guardrails and human review: https://developers.openai.com/api/docs/guides/agents/guardrails-approvals
- OpenAI Moderation guide: https://developers.openai.com/api/docs/guides/moderation
- OpenAI API data controls: https://developers.openai.com/api/docs/guides/your-data

As of 2026-11-03, the published policy update marked effective 2026-11-20 is not yet in force. This project adopts its relevant safeguards as a forward-compatible product baseline now. Re-check official policy pages before every public launch and whenever the product adds a new capability.

## Product boundaries

1. The platform is an owner-controlled agent network, not an unreviewed autonomous actor.
2. The platform may integrate a model to power its own product features. It must not offer a raw third-party model-access router or intermediary without first obtaining any review/approval required by the applicable OpenAI policy and agreement.
3. Do not use OpenAI services for prohibited activity, unlawful activity, deceptive impersonation, spam, unauthorized surveillance, privacy violations, or harmful cyber activity.
4. Do not present an agent as a licensed professional or allow it to independently provide regulated professional advice where licensed professional involvement is required.
5. Do not automate high-impact decisions or submissions affecting employment, credit, housing, insurance, education, medical care, legal rights, migration, essential services, or similar consequential interests without meaningful human review and applicable professional/legal controls.
6. Never use OpenAI outputs to train or improve a competing model or service in ways prohibited by the applicable Usage Policies.

## Required engineering controls

### Identity, authority, and tenancy
- Authenticate users before accessing private agent resources.
- Resolve owner, organization membership, capabilities, and grants on the server for every request.
- Enforce tenant boundaries in database queries and tests; never trust client-supplied owner or organization identifiers.
- Use least privilege, expiry, revocation, use limits, and atomic grant consumption.

### Human approval and side effects
- Planning is not authorization.
- Pause before external or consequential side effects.
- Approval must bind to the exact payload, recipient, purpose, data scope, grant, and expiry.
- Revalidate owner authority, grant status, approval digest, and exact payload immediately before execution.
- Deny on timeout, stale approval, revoked grant, changed payload, missing policy service, or ambiguous authority.
- Never permit a model to approve its own action or change its own capabilities.

### Prompt injection and untrusted data
- Treat web pages, files, messages, tool results, and model output as untrusted data.
- Keep trusted policy and capability data server-owned and structurally separate.
- Do not let retrieved content modify system policy, identity, permissions, recipients, or approval state.
- Validate every model-proposed action against a server-derived allowlist.
- Red-team direct and indirect prompt injection, data exfiltration attempts, tool misuse, and cross-tenant access.

### Content safety and abuse
- Add input/output moderation or an equivalent reviewed safety control before exposing generative features publicly.
- Treat moderation results as signals for routing/review, not as a complete safety system.
- Provide user reporting and a monitored abuse-response process.
- Add rate limits, quotas, bounded input/output, abuse monitoring, and safe error handling.
- Do not send suspected child sexual abuse material to the Moderation API; follow OpenAI child-safety guidance and applicable law.

### Privacy and data governance
- Minimize data sent to each model/provider; do not send private fields unless specifically authorized and necessary.
- Document provider retention, training use, region, subprocessors, deletion, and incident response before enabling a provider.
- Use privacy-preserving stable safety identifiers when calling OpenAI APIs where appropriate; never send raw email or username solely for this purpose.
- Define retention/deletion/export controls for platform data and audit records.
- Disclose when data is processed by third-party tools or MCP servers and apply their terms and retention policies.

### Reliability and transparency
- Use bounded timeouts, retries, budgets, idempotency, cancellation, and dead-letter handling.
- Fail closed when policy or authorization checks are unavailable.
- Clearly label generated content and agent limitations; never imply an action occurred when it was only drafted or planned.
- Maintain audit trails for permission changes, approvals, denials, execution attempts, and outcomes.
- Run adversarial tests and evaluate the product on representative and misuse-oriented cases before launch.

## Current implementation status

- Implemented before this baseline: tenant-scoped ownership, capability/grant primitives, field-level disclosure controls, digest-bound human approvals, audit records, and a provider-neutral plan schema.
- Implemented in this phase: bounded request validation, strict plan validation, unique step/source identifiers, server-provided action allowlist validation, and provider-failure handling that returns a generic safe result.
- Not yet implemented: worker/lease processing, real provider integration, moderation, public abuse reporting workflow, production observability, user-facing execution approvals, and external action executor. Persisted run queueing and owner cancellation are implemented, but execution remains disabled.
- Therefore this repository is not yet production-ready and this document does not certify compliance. Each missing control is a release gate for the corresponding feature.

## Release gates

Do not enable a public generative feature until its moderation/safety workflow, abuse reporting, rate limits, privacy disclosure, provider data controls, and red-team tests are implemented and reviewed.

Do not enable any external side effect until exact-payload approval, live grant revalidation, idempotency, atomic consumption, audit, cancellation, and failure recovery are tested end-to-end.

Do not launch as a model-access intermediary until the applicable OpenAI prior-review/approval requirement has been resolved in writing.
