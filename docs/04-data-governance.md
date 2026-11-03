# Data Governance, Residency & Lifecycle

- Document ID: TAN-DATA-001
- Version: 1.0.0
- Status: Baseline policy design; jurisdictional review required

## 1. Objectives

Collect only data necessary for a stated purpose, keep it within approved boundaries, expose it only to authorized audiences, preserve provenance, and honor owner controls subject to law, security, and legitimate operational duties.

## 2. Data domains

- Account and authentication data
- Individual profile data
- Organization and membership data
- Agent identity, capabilities, and preferences
- Intent and discovery data
- Candidate and match data
- Conversation and message data
- Sources, claims, and evidence
- Verification records
- Permission grants and approvals
- Audit and security events
- Integration credentials and provider metadata
- Billing and usage data, if introduced in a separately approved phase

Each domain must have a named data owner, system-of-record, classification, purpose, access policy, region, retention schedule, and deletion/export behavior.

## 3. Classification

### Public
Information explicitly selected for public discovery. Examples may include a public agent description, declared public capabilities, languages, and public business contact channel.

### Contextual
Information intended for a particular interaction or purpose, such as a broad availability window or a non-sensitive requirement. It must not be repurposed for unrelated discovery.

### Private
Personal preferences, internal business requirements, private messages, non-public documents, and personal contact information not explicitly made public.

### Highly Sensitive
Authentication secrets, financial credentials, government identity documents, protected health information, precise location history, and other data whose exposure may cause substantial harm.

The owner may choose a stricter classification. Legal and regulatory classifications override product defaults.

## 4. Disclosure policy

Every field must carry:
- classification;
- purpose(s);
- allowed audience(s);
- allowed recipient type(s);
- default state;
- owner consent/grant reference;
- region constraints;
- onward-sharing restrictions;
- expiry and revocation behavior.

Disclosure is evaluated at the point of use, not only when a profile is saved. A field may be visible to one verified organization for one task while remaining hidden from the public registry and other agents.

## 5. Regional residency model

Target design is regional data planes coordinated by a minimal global control plane.

The control plane may hold routing and service metadata only where lawful and necessary. Private content remains in its designated region unless a documented transfer is approved. Global availability does not mean global replication.

Before selecting a region/provider:
1. map data categories and processing purposes;
2. identify controller/processor roles;
3. assess local storage and transfer requirements;
4. assess subprocessors and support access;
5. define encryption and key custody;
6. define backup and disaster-recovery geography;
7. define lawful transfer safeguards and user notice;
8. document residual risk and approval.

No region or cloud vendor is selected by this baseline.

## 6. Cross-region transfer

A transfer record must capture:
- source and destination region;
- data categories and minimization;
- purpose and legal basis;
- recipient/processor;
- transfer mechanism/safeguards where required;
- authorization and policy version;
- time, duration, and outcome;
- deletion/return obligations.

If region policy cannot be resolved, protected payload transfer is denied. A routing failure must not silently fall back to a non-approved region.

## 7. Retention and deletion lifecycle

Lifecycle states:
**Collected → Classified → Active → Restricted/Expired → Deletion Pending → Deleted**, or **Retained Under Legal/Security Hold** until the hold expires.

Retention is defined by data category and purpose, not one universal duration. Owner policy applies within legal obligations, security needs, dispute handling, and documented platform requirements.

Deletion workflow:
1. authenticate requester and verify authority;
2. locate data and derived copies;
3. identify legal holds and mandatory retention;
4. restrict processing while request is evaluated where appropriate;
5. delete or irreversibly de-identify eligible data;
6. propagate deletion to indexes, caches, replicas, and processors according to contracts;
7. record minimal deletion evidence;
8. notify requester of completion or lawful limitation.

Backups require a defined expiry/rotation strategy. Deleted data must not re-enter active systems during restore without replaying deletion tombstones.

## 8. Audit records

Audit records should retain only what is necessary to prove a decision or action. They must not become a shadow copy of private content. Use references, hashes, event metadata, and minimized excerpts where possible. Retention and access are separately controlled.

## 9. Data quality and provenance

Source and evidence records should include source identity/type, URL or reference, retrieval time, publisher/issuer, claim linkage, extraction method, integrity metadata, freshness/expiry, and known limitations. Preserve original source context when legally permitted. Distinguish direct source statements from model-generated summaries.

Conflicting evidence must remain visible. Similar names, organizations, or agents must not be merged solely by fuzzy similarity.

## 10. Data subject and owner controls

Provide workflows for:
- viewing profile and agent data;
- correcting inaccurate data;
- changing discoverability and field policies;
- reviewing active grants and approvals;
- revoking access;
- exporting supported data;
- requesting deletion;
- challenging verification or reputation claims;
- seeing meaningful explanations for restrictions.

## 11. Data governance release checklist

No data category may be added to production without a purpose, classification, owner, lawful basis assessment, access policy, region, retention schedule, processor assessment, threat assessment, and tested export/deletion behavior.
