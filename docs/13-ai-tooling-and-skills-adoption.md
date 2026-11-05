# Reusable AI tooling and skills adoption assessment

- Document ID: TAN-AI-TOOLS-001
- Version: 1.0.0
- Status: Engineering assessment; no runtime dependency or connector enabled by this document
- Decision owner: Product owner
- Baseline: existing Next.js 15 / React 19 / TypeScript / Better Auth / Prisma 6 / PostgreSQL modular monolith
- Autonomy model: Delegated Agent

## 1. Executive decision

Do not replace the current application with a new agent framework and do not install a collection of overlapping frameworks.

Adopt a standards-first, adapter-based path:

1. Keep PostgreSQL, Prisma, Better Auth, the current tenant/security modules, persisted AgentRun worker, permission grants, memory governance, and digest-bound approvals as the system of record.
2. Evaluate the official OpenAI Agents SDK for TypeScript as the first orchestration adapter. Use it only behind the existing provider/runtime boundary for agent loops, typed function tools, guardrails, MCP connectivity, handoffs when justified, and tracing.
3. Keep deterministic authorization, grant reservation/consumption, approval decisions, audit records, retention, and durable task state in the existing application. SDK sessions or model context must not become a second authority or database.
4. Treat MCP as the tool/data integration protocol and A2A as the agent-to-agent interoperability protocol. They solve different problems and must be introduced in separate, testable phases.
5. Adopt the open Agent Skills format for reviewed procedural knowledge. A skill is not a connector, permission, model, or executable tool. It must never grant authority by itself.
6. Use coding-agent skills from trusted repositories for development review and test generation only; do not expose those coding skills as user-facing runtime capabilities.

The objective is to reuse mature components without surrendering tenant isolation, least privilege, user consent, exact-payload approval, or portability.

## 2. Verified repository baseline and gaps

### Existing implementation found

The `feature/agent-runtime-hardening` branch contains:
- Next.js workspace UI and a local-storage-only persona profile.
- A demo API route that uses HTML parsing of DuckDuckGo results for search and generates advertisement copy from a deterministic local template.
- A strict Zod plan contract and an OpenAI Responses API provider.
- The provider can call the Responses API web-search tool and extract returned source metadata.
- A worker that claims persisted runs, revalidates agent configuration and grants, checks consent/moderation, creates a plan, and persists proposed steps and sources.
- The worker is a planner, not an external action executor. It does not send messages, publish content, transact, or execute arbitrary tools.

The live workspace code on that branch still describes profile storage as local to the browser. The demo advertisement is explicitly a local template, not an AI-generated result.

### Existing draft work that must be reconciled, not rebuilt

The repository currently has a long stack of open Draft PRs:
- PR #29 connects the personal workspace to authenticated, persisted agent runs, scoped grants, provider consent, and source-linked plans. Its PR description records run #357 as pending/in progress at that time and says the PR is not deployed.
- PR #32 adds owner-controlled personal memory, opt-in model context, provenance, classification, expiry, and owner controls. Its PR description reports CI run #382 passing.
- PR #34 adds deterministic, owner-reviewed memory suggestions. Its PR description reports CI run #391 passing.
- PR #35 binds approvals to the live permission-grant version; it is stacked on #34 and does not add an executor.
- PR #36 adds owner review for personal-agent approvals; it is stacked on #35 and does not add an executor.
- PR #31 records the approved Delegated Agent operating model.

These PRs are not equivalent to merged or deployed functionality. The #32 → #34 → #35 → #36 sequence must be reviewed as a stack; #35 and #36 need current CI evidence before acceptance. The wider parent chain from #29 and its dependencies must also be reconciled. Do not merge PRs out of order.

### Product-critical gaps still visible

- No production-grade tool execution gateway is present in the inspected worker; plans are persisted as proposals.
- No live MCP client/server integration has been demonstrated in this application.
- No A2A conformance or external agent exchange has been demonstrated.
- The currently inspected workspace branch is not the account-persisted workspace implementation in PR #29.
- The current demo advertisement route is a local template, not a connected publishing workflow.
- Provider credentials, worker secret, scheduler readiness, and spend limits must be configured and tested before live provider runs; no paid API calls are authorized by this assessment.
- The README correctly describes the product as an early foundation, not production-ready.

## 3. Framework assessment

| Candidate | Reuse value for TAN | Decision |
|---|---|---|
| OpenAI Agents SDK for TypeScript | Agent loop, typed function tools, guardrails, handoffs, MCP integration, tracing; matches the existing TypeScript server | **Preferred first adapter to prototype** |
| LangGraph | Durable graph orchestration, checkpoints, human-in-loop patterns | Do not add now: overlaps with the existing PostgreSQL worker, run lifecycle, and approval state |
| Google ADK for TypeScript | Code-first agents, MCP and A2A ecosystem | Keep as a future interoperability comparison; adding it now duplicates orchestration and increases provider/platform surface |
| Mastra | TypeScript agent/workflow framework | Do not add now: overlaps with existing workflow and persistence layers |
| CrewAI | Role-based multi-agent orchestration | Do not add now: Python runtime would introduce a second application runtime without a demonstrated need |
| Microsoft Agent Framework | Enterprise workflows and MCP/A2A support | Revisit only if a concrete enterprise/.NET integration requires it |

### OpenAI Agents SDK integration boundary

The official SDK documentation describes the SDK path as appropriate when the application server owns deployment, tool implementations, state storage, and approval decisions while the SDK runs the agent loop. This maps to TAN's existing architecture.

Prototype the SDK behind an adapter; do not replace:
- `AgentRun` and `AgentRunStep` persistence;
- the worker lease/recovery and per-agent locks;
- permission grants and their live revalidation;
- provider-processing consent and personal-memory filtering;
- digest-bound, grant-version-bound approval records;
- tenant authorization and audit logging.

Every SDK function tool must call a server-side policy gateway. Tool availability must be derived from the authenticated owner, tenant, current grant, target, data scope, and action allowlist. A model-selected tool name is never authorization. Tool outputs are untrusted data.

The first prototype should expose only read-only, low-risk capabilities already supported by the product, such as public-web research and public agent-profile discovery. Message sending, posting, uploads, account access, purchases, payments, signatures, and binding commitments remain disabled until a separate executor and approval-consumption lifecycle pass security tests.

## 4. Protocol boundaries

### MCP

Use MCP for controlled access to external tools and data sources. Start with one read-only server or adapter in a test environment. Require:
- explicit provider registration and purpose;
- authenticated transport and correctly scoped credentials;
- tool allowlists and strict argument/output schemas;
- outbound endpoint validation and network restrictions;
- disclosure-policy filtering before data leaves TAN;
- timeouts, bounded retries, idempotency where applicable, and cost/usage limits;
- audit correlation and revocation;
- prompt-injection tests against tool descriptions and tool results.

Do not accept arbitrary user-supplied MCP URLs or forward ambient credentials. Do not let MCP tools mutate grants, approve their own work, or bypass the execution gateway.

### A2A

Use A2A only after the local agent runtime and its tool gateway are reliable. Implement a narrow supported profile first: authenticated agent discovery, capability declaration, task creation/status, signed or authenticated identity assertions where required, bounded payloads, and explicit owner approval for any consequential action. Protocol compatibility is not trust or permission.

## 5. Skills assessment and adoption policy

The open Agent Skills format packages procedural knowledge in a directory with a `SKILL.md` file and optional references/assets/scripts. Its progressive-disclosure model is suitable for loading a short description first and full instructions only when a skill is relevant.

### Candidate development skills

| Skill / source | Useful work | Adoption status |
|---|---|---|
| GitHub `awesome-copilot` — `security-review` | Review auth, tenant boundaries, injection, secrets, dependency and business-logic risks | Candidate for development-time review; inspect exact files and license before copying |
| GitHub `awesome-copilot` — `poka-yoke` | Make unsafe states and invalid API usage difficult to express | Candidate for schema/state-machine review |
| GitHub `awesome-copilot` — Playwright explore/generate-test skills | Explore the real UI and draft browser tests | Candidate for test authoring; generated tests still require execution and review |
| OpenAI `plugins` — `agents-sdk` skill | Ground coding work in official Agents SDK docs and examples | Candidate for SDK integration work; development-time only |
| Microsoft `skills` repository | Azure/Foundry and related agent-development examples | Reference only for now; repository labels itself Work in Progress |

### Licensing and supply-chain rules

- The Agent Skills specification repository states Apache-2.0 for code and CC-BY-4.0 for documentation; verify each skill directory's own license.
- Do not copy Anthropic prebuilt skills into this commercial product without a separate rights review. The published skill license terms include restrictions on retaining, copying, creating derivatives, and distributing those materials.
- Prefer original TAN-authored skills or skills with clear permissive licenses. Record source URL, commit SHA, license, author, last review date, dependencies, and hash.
- No skill scripts execute merely because a skill is installed. Scripts, binaries, MCP endpoints, and external references require separate code review, sandboxing, and explicit enablement.
- Skills can guide a workflow but cannot grant permissions, alter policy, access secrets, or authorize side effects.

### Initial TAN skill candidates to author or adapt

1. `public-market-research`: gather public sources, distinguish evidence from claims, report dates and uncertainty.
2. `buyer-supplier-discovery`: identify potential buyers/sellers from public sources; no outreach.
3. `arabic-commercial-copy`: draft Arabic/English product listings with missing-fact warnings; no publication.
4. `source-verification`: cross-check organization identity, official domain, source freshness, and conflicting claims.
5. `delegated-action-safety`: classify risk and prepare an exact-payload approval request; never approve or execute.

These should be authored as original, versioned instructions and tested against adversarial examples before runtime exposure.

## 6. Delivery sequence and acceptance gates

### Gate 0 — reconcile the existing stack
- Map every open PR and its base/head dependency.
- Obtain current CI status for every head in the #24 → #29 → #31 → #32 → #34 → #35 → #36 path.
- Resolve conflicts and duplicate changes without rebasing or merging blindly.
- Confirm the deployed branch and database migration status before any deployment work.

### Gate 1 — one account-persisted demo journey
- Sign in.
- Create or load the owner's personal agent from PostgreSQL.
- Save and restore the persona after a fresh login.
- Set the memory/provider-consent controls explicitly.
- Create a bounded public-web research grant.
- Submit a research task and see its persisted run state, result, source links, and audit record.
- Show a clear disabled/blocked state when credentials, consent, grants, or worker readiness are absent.

### Gate 2 — SDK adapter proof
- Add the SDK only after a pinned version and license review.
- Keep a provider-neutral internal request/result contract.
- Add one read-only function tool with schema validation and server-side authorization.
- Persist run/tool events in the existing database.
- Test retries, cancellation, timeout, revocation during execution, malformed tool output, prompt injection, and trace redaction.
- Keep the current direct Responses provider available until adapter parity is demonstrated.

### Gate 3 — reviewed skills
- Add a skill registry with version, provenance, license, owner/tenant scope, and enabled state.
- Load only reviewed instructions for the current task.
- Keep skills separate from grants and tools.
- Test malicious instructions, oversized content, stale skill versions, and attempts to override system policy.

### Gate 4 — MCP connector
- Integrate one read-only MCP connector through the policy gateway.
- Pass protocol, auth, schema, timeout, revocation, and audit tests before enabling it for users.

### Gate 5 — external actions and A2A
- Implement a separate execution gateway and approval consumption only after exact-payload, grant-version, idempotency, replay, concurrency, and rollback tests pass.
- Add A2A only after the local profile, trust, discovery, and task contracts are stable.

## 7. Demo and investor evidence checklist

A credible demo must show, live:
- account login and persistent owner identity;
- the same agent restored after logout/login;
- a natural-language task in Arabic and English;
- a real model/tool run, not a hard-coded mock presented as AI;
- source URLs and explicit evidence/uncertainty labels;
- persisted task history and audit events;
- a permission-denied case and a revoked-grant case;
- an exact-payload approval screen for a consequential action, with execution disabled until the separate executor is proven;
- clear provider/model/cost disclosure and a reproducible test report.

A product demo is not proof of market demand, revenue, security certification, or OpenAI endorsement. Any OpenAI pitch or funding outreach must be framed as a proposal and backed by a reproducible demo, architecture/security evidence, customer validation, and a clear commercial thesis.

## 8. Cost and change controls

- No paid API calls, new paid infrastructure, provider account changes, secret changes, production migrations, merges, or deployments are authorized by this document.
- Use fake providers and isolated PostgreSQL in CI; live-provider tests remain opt-in.
- Enforce provider-side hard spending limits before any live demo.
- Do not reset the database or replace PostgreSQL.
- Keep all integrations optional and disable them by default until their acceptance gates pass.

## 9. Primary references

- OpenAI Agents SDK overview: https://developers.openai.com/api/docs/guides/agents/sdk
- OpenAI Agents SDK TypeScript repository: https://github.com/openai/openai-agents-js
- OpenAI orchestration and handoffs: https://developers.openai.com/api/docs/guides/agents/orchestration
- OpenAI integrations and observability: https://developers.openai.com/api/docs/guides/agents/integrations-observability
- MCP specification and authorization: https://modelcontextprotocol.io/specification/
- Agent Skills specification: https://agentskills.io/
- GitHub Awesome Copilot skills: https://github.com/github/awesome-copilot
- Microsoft skills (work in progress): https://github.com/microsoft/skills
- OpenAI Agents SDK coding skill: https://github.com/openai/plugins/tree/main/plugins/openai-developers/skills/agents-sdk
- Anthropic skills license example: https://github.com/anthropics/skills/blob/main/skills/pdf/LICENSE.txt
