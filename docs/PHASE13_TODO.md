# RetailBooks Phase 13 - Secure AI and RAG implementation plan

**Status:** in progress. Phase 13B's private-gateway foundation (now including a hosted DeepSeek
adapter, gated off by a second kill switch pending 13A), 13C's deterministic drill-down and
"explain a number" API and UI, 13D's secure document-extraction pipeline, 13E's categorization and
variance suggestions, 13F's P1 and P2 workflow releases (P2's six capabilities now on independent
feature flags and permission keys), and 13G's per-organization feature-flag rollout mechanism are
all implemented. The feature-flag kill switch is verified end to end over real HTTP, and the
repository's fast gates (format, lint, typecheck, build, Prisma validate/migrate status) and its
full unit (199 tests) and integration (457 tests, 66 files, up from 436/62 on 2026-09-14: a
cross-tenant citation test, a prompt-injection test, fixture-correctness tests for genuinely all
thirteen 13E/13F advisers (an earlier pass this same day wrongly claimed this was already true at
nine of thirteen — corrected, see 13E/13F below), and a live ClamAV/OCR pipeline proof including a
real PDF round trip) suites pass with zero failures, including an 8-role
permission/tenant-isolation/404-envelope sweep across all 353 organization-scoped routes. A first
browser/E2E pass now covers the report Explain panel, all six `insights` tabs, and document search
(`phase13-ai-workflows.spec.ts`) — see 13G below for what that pass found and fixed. A live round
trip through the real ClamAV scan and tesseract OCR pipeline is now proven for both images and
PDFs (see 13D above), and E2E specs for the four remaining UI surfaces are written (typecheck/lint
clean) but not yet run against live infrastructure — blocked on local machine memory, not code.
Closing out this phase's remaining test gaps found and fixed **three real production bugs**, none
hypothetical: PDF rasterization was completely broken (13D), and
`AuditEvidencePackService.assemble()` crashed for every Expense, one of its three documented
entity types (13F-P2) — both alongside the two bigint-arithmetic bugs found earlier in the phase.
**Still open:** 13A's threat model, evaluation set, and quality-holdout gates (this also blocks
ever enabling the new hosted-DeepSeek flag for a real tenant); running the new E2E specs against
live infrastructure; and a separate evaluation
set per 13F-P2 capability (the flag/permission split itself is done).
`docs/BUILD_ROADMAP.md` and `docs/GAPS.md` are intentionally not yet updated — 13G's own rule is to
update them only once a capability has passed its acceptance tests, and the gates above remain open.  
**Prepared:** 2026-09-13. **Updated:** 2026-09-14.  
**Scope authority:** `docs/BUILD_ROADMAP.md` Phase 13. This document adds implementation detail
and staged enhancements; it does not mark roadmap or `docs/GAPS.md` items done.

## Outcome and fixed boundaries

RetailBooks will use DeepSeek models to help users find, understand, and prepare accounting work.
PostgreSQL and the existing domain services remain the source of financial truth. Retrieval-augmented
generation (RAG) finds relevant documents; it does not calculate balances or authorize access.
Every model-produced suggestion is reviewable, attributable to a model/run, and subject to the
same organization and action permissions as the underlying workflow. No model response directly
posts a journal, issues a document, approves a request, sends a reminder, or enables a rule.

The most secure deployable mode is a self-hosted DeepSeek open-weight model exposed through an
API-compatible private endpoint, local OCR and embeddings, PostgreSQL retrieval, and no public
model traffic. A DeepSeek-hosted
API adapter is intentionally not implemented in this foundation. It may be considered only for a
tenant and a data class that have passed the privacy, contractual, transfer, and egress gates below.
Choosing RAG alone is not a security perimeter or a guarantee of factual answers.

## Sources and how this plan uses them

| Source                                                                                        | Adopted guidance                                                                          | Qualification                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/BUILD_ROADMAP.md` Phase 13; build specification section 15; master blueprint section 13 | Six required capabilities and the no-autonomous-ledger rule                               | These remain the product scope authority.                                                                                                                                                                                                                           |
| User-provided `DeepSeek_AI_Security_And_Privacy_Data_Protection_Standards.pdf`                | Private deployment, data minimization, tenant isolation, source attribution, auditability | Its compliance claims are not legal determinations. Regex is only one detector, not sufficient de-identification. No documented training opt-out HTTP header was verified.                                                                                          |
| User-provided `DeepSeek_Financial_RAG_Guidelines.pdf`                                         | Exact SQL for structured facts plus retrieval for document meaning; structured outputs    | Do not grant a model arbitrary text-to-SQL. Temperature zero does not eliminate hallucinations. The example model IDs are not pinned here; validate current supported models at integration time. Its autonomous-bookkeeping framing does not override the roadmap. |

Current external references: [DeepSeek API models](https://api-docs.deepseek.com/quick_start/pricing/),
[Responses API](https://api-docs.deepseek.com/api/create-response/),
[privacy policy](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html),
[OWASP prompt injection guidance](https://genai.owasp.org/llmrisk/llm01-prompt-injection/),
[PostgreSQL row security](https://www.postgresql.org/docs/17/ddl-rowsecurity.html), and
[Kenya ODPC guidance index](https://www.odpc.go.ke/guidelines-2/). Recheck provider terms and
model capabilities immediately before implementation and deployment. The external privacy policy
does not itself settle the terms for RetailBooks' downstream customer data.

## Existing foundations and code ownership

- `apps/api/src/reporting/reporting.service.ts` and `report-registry.ts` supply typed report keys,
  filters, SQL-backed totals, and traceable rows. Extend their drill-down path for aggregate
  explanations; do not fabricate a source reference for an aggregate row.
- `apps/api/src/purchases/expenses.controller.ts`, `apps/api/src/attachments`, and the existing
  draft/approval/post routes own receipts and financial state changes.
- `apps/api/src/banking` owns transaction matching and bank rules; `apps/api/src/automation`
  owns approvals, reminders, tasks, and scheduled jobs. AI should propose into these surfaces,
  not create parallel posting or scheduling engines.
- `OrganizationGuard`, `@RequirePermission`, and `OrganizationRequest` define tenant/actor
  context. `apps/api/src/organizations/permission-catalog.ts` and the shared contracts own new
  permission keys and DTOs.
- `apps/api/prisma/schema.prisma` and PostgreSQL hold tenant-scoped records. MinIO/S3-compatible
  storage holds attachments. The current `postgres:17-alpine` image does not include pgvector;
  introduce and migration-test a PostgreSQL 17-compatible pgvector build before using vector
  columns. Keep keyword retrieval as a working fallback.
- `packages/config/src/index.ts` validates runtime configuration; secrets and provider mode must
  fail closed at startup. Reuse the existing worker/queue patterns for extraction and indexing.

## Trust boundaries and data route

1. Authenticate the user; derive organization, membership, and permissions on the server. Never
   accept an organization ID, permission, source ID, or model-supplied URL as proof of access.
2. Classify the request into a supported intent: report calculation, document search, extraction,
   proposal, or unsupported. Apply both the AI capability permission and the underlying domain
   permission (`reports.view`, expense, banking, approvals, etc.).
3. For amounts, call allowlisted report/domain functions with validated filters. Keep all money as
   integer minor units or existing decimal contracts, with explicit currency, basis, period,
   time zone, and as-of date. The model may select from an allowlisted intent schema, never send
   raw SQL or evaluate code. Server code decides the query and checks its result.
4. For documents, search only an authorized tenant's indexed attachments and approved policy
   material. Filter by organization, entity permission, visibility, status, and document version
   **before** content is put in a prompt. Search exact keywords and local embeddings, then rerank
   a bounded candidate set. A vector index is not an authorization layer.
5. Construct a minimal evidence envelope: typed values, source entity IDs, attachment ID/page or
   text span, content hash/version, report key/filters, and retrieval timestamp. Treat every
   retrieved document as untrusted data, including any text that pretends to be instructions.
6. Route to a tenant-permitted model endpoint with a strict outbound payload policy. Ask for a
   small schema-constrained result. Parse and validate it locally, verify every cited source ID
   against the authorized evidence set, and reject unsupported numbers or claims. On missing,
   conflicting, stale, or insufficient evidence, return an explicit unable-to-verify result.
7. Persist only the necessary run metadata and proposal/evidence references. Return an explanation
   with visible sources and a separate review action. A confirmed action re-enters the existing
   domain controller/service with its normal permission, validation, idempotency, approval,
   period-lock, and audit checks. Recheck permissions at confirmation time.

### Provider and privacy policy

| Data class                                                          | Default model route   | Hosted DeepSeek route                                                                                                                      |
| ------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Synthetic/public examples, generic UI copy                          | Private endpoint      | Optional after normal provider configuration.                                                                                              |
| Organization reports and non-personal financial summaries           | Private endpoint      | Off until tenant opt-in and documented legal, contractual, location, retention, and payload review. Send only the minimum approved fields. |
| Raw receipts, bank lines, tax IDs, names, contacts, attachment text | Private endpoint only | Prohibited in the initial release. Redaction does not automatically make a financial record anonymous.                                     |
| Secrets, credentials, access tokens                                 | Never sent to a model | Never sent to a model.                                                                                                                     |

- Use a dedicated server-side `AiModelGateway`; the browser never receives a provider key. Pin
  tested model identifiers and versions in config/run records, allowlist base URLs, use TLS and
  scoped credentials, timeouts, bounded retries, token/cost/rate caps, and a circuit breaker.
- Set default-deny egress for model/OCR/embedding workers and explicitly allow only the selected
  private endpoint. Hosted mode requires a separate allowlisted route and a visible organization
  setting. A privacy gate must verify provider processing terms, retention, training controls,
  subprocessors, data location, incident handling, and any required transfer assessment. Do not
  infer these from a prompt, a header, or the supplied PDFs.
- Do not log raw prompts, document text, model responses, provider keys, or signed download URLs.
  Keep a redacted request/evidence hash, actor, organization, purpose, model/version, timestamps,
  outcome, token usage, and reviewer action. Encrypt sensitive stored content and backups; set a
  short, documented retention period for transient extraction text and allow indexed content to be
  deleted or reindexed when the source changes or is deleted.
- Use allowlisted structured fields plus local PII detection and a manual review path for any
  proposed external payload. Regex may help find obvious IDs, emails, and phones, but cannot
  prove de-identification. No cross-tenant context caching or shared prompt history.

### Retrieval and database isolation

- Store embeddings locally in PostgreSQL with `organizationId`, source entity/attachment ID,
  visibility, version/hash, chunk location, model/version, and created/deleted timestamps. Index
  only supported attachments after file-type validation, malware scanning, and local OCR. Do not
  index portal/customer-visible material into internal search without an explicit access policy.
- Add app-level organization and permission filters to every retrieval query. Add PostgreSQL RLS
  on AI index/run/proposal tables as defense in depth, using a dedicated non-superuser, non-owner
  application role without `BYPASSRLS`; table owners/superusers otherwise bypass RLS. Set tenant
  context transaction-locally after authentication, and test pooled-connection reuse. Existing
  business tables continue through their authorized services until a separately reviewed RLS
  migration exists. Never assume RLS replaces endpoint authorization.
- Recheck access when opening a citation or attachment; store source IDs/hashes rather than
  durable signed URLs. Expire or invalidate chunks on source mutation, permission changes,
  organization suspension, or deletion. Bound chunk sizes, search result counts, and model
  context length. No external vector database or embedding API in the private default mode.
- Give the model no unrestricted database, filesystem, network, email, browser, or write tool.
  Retrieved text and uploaded files cannot alter tool choice or policy. Render output as escaped
  text with vetted internal links; block model-generated external URLs and active HTML.

## Feature inventory and sequence

**Core Phase 13: all six are required before the phase is marked complete.**

| Feature                    | Deliverable and evidence                                                                                                                                | Boundary                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Receipt extraction         | Candidate vendor, date, amount, tax, category, currency, and field-level source region; comparison with arithmetic and existing vendor/category records | Review/edit before an Expense draft; never post from extraction.                         |
| Ask your books             | Supported natural-language intents compiled to typed report filters; exact report result and linked evidence                                            | No free-form SQL or invented number.                                                     |
| Explain a number           | Drill-down from a report cell/total to contributing rows and source transactions                                                                        | Identify incomplete pagination or unavailable lineage instead of guessing.               |
| Categorization suggestions | Ranked candidate with reason, historical precedent, and uncertainty                                                                                     | A user must accept; only an explicitly approved existing rule may automate later events. |
| Variance/anomaly insights  | Dismissible, reproducible signal with baseline, period, dimensions, and sources                                                                         | Advisory; deterministic detection where possible.                                        |
| Draft text                 | Editable description or reminder based on provided facts                                                                                                | Never send or commit without the existing workflow.                                      |

**Added workflow features.** Ship independently after the core trust and evaluation gates;
priority is based on existing RetailBooks modules and the ability to verify results.

| Priority | Feature                                 | First useful slice                                                                                                              |
| -------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| P1       | Evidence search                         | Search authorized receipts, bills, and related transactions by meaning; open exact source.                                      |
| P1       | Bank reconciliation assistant           | Rank matches and explain amount/date/reference evidence; user confirms through existing reconciliation flow.                    |
| P1       | Month-end close assistant               | Checklist of unreconciled accounts, pending approvals, missing documents, and period exceptions.                                |
| P1       | Duplicate/document discrepancy detector | Compare receipt/bill hashes and fields; flag likely duplicates and document-versus-entry mismatches.                            |
| P1       | Approval briefing                       | Summarize changed fields, amount, related evidence, and policy conditions for an approver.                                      |
| P2       | Cash-flow scenario planner              | Deterministic forecast scenarios for delayed receipts, upcoming bills, and planned spend; model explains assumptions and range. |
| P2       | Collections prioritizer                 | Rank overdue invoices from payment history and exposure; suggest a next review action, not an automatic message.                |
| P2       | Inventory purchasing adviser            | Suggest reorder timing/quantity from stock, sales pace, lead time, and cash constraints.                                        |
| P2       | Project margin adviser                  | Identify unbilled time/expenses and margin erosion from project records.                                                        |
| P2       | Country-pack/policy Q&A                 | Cite versioned configured rules and policy documents; do not present model text as legal or tax advice.                         |
| P2       | Audit evidence pack                     | Assemble existing source documents, approvals, postings, reversals, and reconciliations into a reviewable trail.                |

## Proposed API, storage, and UI contracts

- New Nest `apps/api/src/ai` module with `AiController`, `AiOrchestrator`, `AiModelGateway`,
  `AiEvidenceService`, `AiDocumentIndexService`, and feature-specific adapters. Keep domain writes
  in their existing modules. Add shared Zod request/response schemas in `packages/contracts`.
- Proposed tenant routes: `POST /organizations/:organizationId/ai/ask`,
  `POST .../ai/extractions`, `GET .../ai/extractions/:id`,
  `POST .../ai/suggestions/:id/accept`, `POST .../ai/suggestions/:id/dismiss`,
  `GET .../ai/runs/:id/evidence`, and `GET/PATCH .../ai/settings`. Add rate/size limits and
  idempotency to create/accept routes. No platform-admin path into tenant evidence.
- Permissions: add AI capability keys for asking, viewing/managing suggestions, and managing AI
  settings. Every route also checks the underlying report/expense/banking/etc. permission.
  Suggestions created in jobs store the originating organization and actor/purpose; jobs recheck
  access and source state before delivery or acceptance.
- Suggested tables: `AiRun` (tenant, actor, capability, provider/model/version, status, evidence
  hash, timings, usage, no raw prompt by default), `AiSuggestion` (typed payload, source IDs,
  status, reviewer/time, expiry, run ID), `AiDocumentChunk` (tenant, source ID/version, text
  location, local embedding, visibility), and `AiFeedback` (correction/dismissal reason, run ID).
  Audit suggestion acceptance/dismissal and AI settings changes through the existing audit pattern.
- UI: a compact assistant on Reports and contextual panels on Expenses, Banking, Approvals, and
  period close. Show evidence and uncertainty next to the answer; make correction and dismissal
  first-class actions. Keep a user-visible AI-off state and no-permission state. Never display a
  model's self-rated confidence as verified probability.

## Implementation milestones

### 13A - Security and evaluation foundation

- [ ] Record a threat model and data-flow inventory for model, OCR, embedding, vector index,
      workers, logs, backups, and optional hosted egress. Review prompt injection, malicious
      uploads, tenant leaks, inference abuse, and model/provider failure.
      **First pass written (2026-09-14):** `docs/PHASE13_AI_THREAT_MODEL.md` covers all of the
      above, grounded in the actual code (not generic) — component/data-flow diagram, trust
      boundaries, and a threats section per category with current mitigations and named gaps.
      Explicitly not a completed review: it has not been reviewed by anyone but its author. Do not
      check this box until someone else has actually reviewed it.
- [ ] Approve deployment mode and data classes. Complete a privacy impact and cross-border review
      before any hosted API use with tenant data; document provider terms and retention evidence.
      **Scaffold written (2026-09-14):** `docs/PHASE13_AI_PRIVACY_REVIEW.md` inventories exactly
      what data would move under each mode and lists the specific open questions (DeepSeek's
      hosted terms, jurisdiction/residency, consent capture, data minimization, log/retention,
      egress accountability) a real reviewer needs to answer — it deliberately does not answer
      them itself. This is not a legal/compliance review; the flag stays off until one happens.
- [ ] Build an anonymized, reviewer-labeled evaluation set: at least 100 varied receipts/documents
      and 100 questions across report, retrieval, ambiguous, missing-evidence, and adversarial
      cases; include multiple organizations, currencies, poor scans, and permission levels.
      **Synthetic generator + first batch built (2026-09-14):** `apps/api/eval/` — 110 synthetic
      document cases (5 org/currency profiles, 3 scan-quality tiers, varied date/currency/vendor/
      amount presentation) and 115 Q&A cases (report/retrieval/ambiguous/missing-evidence/
      adversarial, ~23 each) with reviewer-facing ground truth, a frozen dev/holdout split, and a
      real scoring harness (`node eval/generate-and-score.ts`) already run against the actual
      deterministic extractor. Per the decision recorded with the user: synthetic and
      Claude-labeled, explicitly **not yet human-reviewed** — `apps/api/eval/README.md` states
      this and its known limitations (the Q&A baseline classifier is likely over-fit to its own
      templates; the extractor's `vendorName` field essentially never returns null in practice,
      surfaced by this harness, not hidden by it) plainly. Do not check this box until a human has
      actually reviewed the generated cases.
- [ ] Define model-independent baselines and frozen holdouts. Select private inference and local
      OCR/embedding models by measured field accuracy, latency, resource cost, and security, not
      by model branding. Record versions for reproducibility.
      **Partial (2026-09-14):** the frozen dev/holdout split (id-hash-keyed, stable across corpus
      growth) and a real model-independent baseline are both in `apps/api/eval/` — the
      deterministic receipt extractor's actual per-field accuracy on the document holdout, and a
      trivial keyword classifier's category accuracy on the question holdout (the latter's
      ceiling is not trustworthy yet — see the README's limitations section). **Not done:** no
      inference or OCR *model* selection has happened (tesseract.js is the only OCR in use; no
      model comparison has been run), since that depends on 13A's other gates and on
      `AI_MODE` actually being enabled for evaluation, which stays off.

### 13B - Private model gateway and tenant-safe evidence

**Implemented foundation (2026-09-13; milestone remains open):** `AI_MODE` is `off` by default
and currently permits only an explicitly configured private API-compatible endpoint. Production
requires HTTPS and a hostname allowlist; the public DeepSeek API hostname is explicitly rejected.
The initial `POST /organizations/:organizationId/ai/ask` slice runs an exact existing report, sends
a capped row envelope to the private gateway with no tools, validates structured citations, stores
hashes and source references only, and fails closed. `AiRun` and `AiEvidence` are tenant RLS tables
used through a transaction-local organization context; AI permissions, system-role backfill, and
audit events are included. Verified locally: `npm run test --workspace @retailbooks/config` (9
tests), `npm run test --workspace @retailbooks/api` (161 tests), API build, Prisma schema
validation, and targeted lint/format checks. The focused integration test has now passed with a
restricted non-login role: it verifies that RLS denies no-context and cross-tenant reads, permits
the matching tenant within a transaction-local context, and clears that context on connection
reuse. Production startup now rejects a superuser, `BYPASSRLS`, or AI-table-owner runtime role;
the DBA role-provisioning template is `infrastructure/postgres-runtime-role.sql`. The gateway now
uses bounded retries for transient provider failures and opens a cooldown circuit after repeated
failures. The ask route now applies Redis-backed hourly limits for both an actor within an
organization and the organization as a whole before report retrieval or model contact. Actual
production runtime role provisioning remains a deployment gate, intentionally not marked complete.

**Hosted DeepSeek adapter proof (2026-09-14):** `AI_MODE=hosted_limited` is now implemented
end-to-end (`packages/config/src/index.ts`, `AiModelGateway`), targeting only the hard-coded
`https://api.deepseek.com` host (no env var can redirect hosted egress elsewhere). It is gated by
a **second, independent** kill switch on top of `AI_MODE`: the `phase13.hosted_ai_egress` feature
flag, seeded `default_enabled: false` in both production
(`20260914070000_seed_phase13_hosted_ai_egress_flag`) and the integration test harness
(`apps/api/test/support/app.ts`) — unlike every other Phase 13 flag, which default on. Setting
`AI_MODE=hosted_limited` alone therefore cannot reach the network; a real per-organization
`ORGANIZATION`-scope `FeatureFlagRule` is required, and that rule must not be added for any tenant
until the Phase 13A privacy, contractual, tenant-choice, and egress reviews (still open, see 13A
below) pass for that tenant and data class. Verified: `packages/config` unit tests (11/11,
including two new `hosted_limited` validation cases), `ai-model.gateway.test.ts` (7/7, including
the literal fail-closed proof "`AI_MODE=hosted_limited` with the flag unset never calls `fetch`"
and a positive case asserting the request goes to `https://api.deepseek.com/chat/completions`
once the flag is enabled for the org), full API unit suite (198/198), typecheck, and lint all
green.

**Local runtime-role proof (2026-09-13):** Docker PostgreSQL now provisions `retailbooks_app` as
a non-superuser, non-`BYPASSRLS` role. Local `DATABASE_URL` uses that restricted role while
`DATABASE_MIGRATION_URL` remains the migration-owner connection. The integration harness creates
and migrates its database with the owner connection, grants runtime access only in the disposable
test database, and verifies the booted API is neither a superuser, an RLS-bypass role, nor owner of
the AI tables. The local owner-only `db:deploy` path has applied the Phase 13 migration, and a
direct no-context `ai_runs` query as `retailbooks_app` returns zero rows. Production credentials
and role creation remain a deployment responsibility.

**Gateway resilience proof (2026-09-13):** private calls retry only bounded transient network,
timeout, throttling, and server failures. A per-endpoint/model in-memory circuit opens after the
configured failure threshold and rejects requests until its configured cooldown elapses. Tests cover
one successful retry and circuit opening after repeated `503` responses; malformed provider output
is still rejected without retry.

**Rate-limit proof (2026-09-13):** `POST /organizations/:organizationId/ai/ask` consumes the
configured per-actor-per-organization and per-organization hourly limits before it invokes the
orchestrator. It reuses the established Redis-backed limiter with an in-process fallback for a
Redis outage; the controller test verifies both scoped counters are consumed first.

**Retention, freshness, and authorization proof (2026-09-13):** `AiRetentionService` sweeps
terminal AI run metadata on the configured 90-day default retention period; evidence references
cascade with the run while original run audit events remain, and every deletion sweep writes an
aggregate `ai.runs_purged` audit event. Before a response is returned, the orchestrator reruns the
exact authorized report and rejects any cited row whose source version changed or disappeared with
`MODEL_EVIDENCE_STALE`. It also re-resolves membership and `reports.view` after the model returns,
so an in-flight revocation cannot disclose an answer. Integration tests prove the AI route
immediately reflects role removal, suspended membership, suspended organization, and deleted
membership states without reaching a model.

- [x] Add validated `AI_MODE=off|private|hosted_limited` configuration, default `off`, with
      separate endpoint/key policy. Fail startup on incomplete or unsafe production AI config.
      **Implemented and verified (2026-09-14):** see the hosted-adapter proof above;
      `hosted_limited` requires `AI_HOSTED_MODEL` always and `AI_HOSTED_API_KEY` in production,
      exactly mirroring the existing `private`-mode checks.
- [x] Implement private DeepSeek-compatible gateway, bounded requests, structured output parsing,
      schema validation, redacted telemetry, timeouts, retries, and circuit breaker. Hosted adapter
      must pass a separate allowlist/payload gate; do not implement a speculative opt-out header.
      **Implemented and verified (2026-09-14):** the hosted adapter reuses the same
      request/retry/circuit-breaker/schema-validation path as private mode, and its allowlist gate
      is the `phase13.hosted_ai_egress` flag described above (no speculative header; a real
      per-organization flag rule is the only opt-in).
- [x] Add AI permissions, organization guard coverage, RLS-backed AI tables with a non-bypass
      runtime role, tenant-scoped audits, retention/deletion, and integration tests for pooled
      connections, suspended tenants, revoked memberships, and role changes.
- [x] Build evidence envelopes and citation resolver with source-version checks. A model response
      with a nonexistent, unauthorized, stale, or unsupported citation fails closed.

### 13C - Deterministic financial answers

- [x] Map a bounded set of question intents to `ReportingService` and domain read services;
      validate date/basis/currency/dimension filters and unsupported combinations. The bounded
      "explain this report" intent (13B `ask`) and a new "explain this displayed number" intent
      (`ReportingService.drillDown` + `AiOrchestrator.explainNumber`) are the only two supported;
      an unsupported report key, a row with no posted activity, or an oversized contributing-line
      set are rejected with a typed reason before any model call.
- [x] Build aggregate drill-down that recomputes contributions under identical filters and
      reconciles with the displayed total. Prevent page-size truncation from changing an answer.
      **Scope note:** implemented for the three ledger-account aggregate reports only
      (`financial.profit-loss`, `financial.balance-sheet`, `financial.trial-balance` —
      `ReportDefinition.supportsDrillDown`); the remaining report families are not yet drillable.
      `ReportingService.drillDown` re-scopes the exact aggregate query to one account, fetches its
      contributing posted `journal_lines` with the same date/type/dimension predicates, and throws
      (never truncates) when the line count exceeds `REPORT_DRILLDOWN_MAX_LINES`. A BigInt
      reconciliation check compares the line sum to the reported total and fails closed
      (`InternalServerErrorException`) on any mismatch — this must never be observed in practice.
      `AiOrchestrator.explainNumber` deliberately diverges from `explainReport`: when AI is off or
      the model call fails for any infrastructure reason, it returns HTTP 200 with the deterministic
      drill-down and an explicit `explanation: { state: 'unavailable', reason }`, never blocking
      report access; a mid-flight authorization loss is the one case that still fails closed with no
      data, matching `explainReport`.
- [x] Add Ask your books and Explain a number UI with source links and clear abstention for
      unsupported or ambiguous questions. DeepSeek writes the explanation, never the amount.
      **Implemented and browser-verified (2026-09-14):** `reports-workbench.tsx` adds an "Explain"
      column to `ReportTable` (gated on `ReportDefinition.supportsDrillDown`) and a
      `NumberExplanationPanel` drawer that always shows the reconciled deterministic breakdown, with
      the AI explanation in its own separately-gated section (an explicit "unavailable" state when
      AI is off, never blocking the deterministic number). The route is permission- and
      tenant-isolation-proven via the authorization-boundary sweep, and a Playwright pass against
      real seeded data (`phase13-ai-workflows.spec.ts`, see 13G) confirms the panel opens with the
      reconciled breakdown and the AI-unavailable notice, is keyboard-reachable, closes on Escape,
      and lays out correctly at a 390px mobile viewport with no horizontal scroll. Not yet checked:
      whether closing the panel returns focus to the triggering row's Explain button -- it doesn't
      currently, since the panel is opened from external component state rather than a Radix
      `DialogTrigger`, which Radix needs to know where to return focus to.

Verification evidence (2026-09-13): `npm run test --workspace=@retailbooks/api` (166 tests, up from
161 — 5 new `ai-explain-number.test.ts` unit tests plus additions to `ai.orchestrator.test.ts`
patterns), `npm run test:integration --workspace=@retailbooks/api -- --run test/reporting.int.test.ts
test/ai.int.test.ts` (13 tests: real-DB drill-down reconciliation across a debit-normal and a
credit-normal account, unsupported-report/no-activity rejection, tenant isolation on a foreign
account id, a report-only role reaching the deterministic drill-down while `POST ai/explain-number`
stays 403 for it, and a disabled-AI request returning 200 with zero `AiRun` rows created), API
typecheck and `nest build`, `npm run test --workspace=@retailbooks/config` (9 tests, unaffected),
`npx prisma validate` (no migration — no schema changes), targeted `eslint --max-warnings=0` and
`prettier --check` on every changed file, and `git diff --check`.

### 13D - Private document pipeline and extraction

- [ ] Add validated, malware-scanned attachment ingestion and sandboxed local OCR. Pin source
      hashes; index only allowed entity types and versions. Use PostgreSQL keyword retrieval first,
      then local embeddings/pgvector after its image and migration are verified.
- [ ] Deliver evidence search and receipt extraction into an editable candidate form. Validate
      date/currency, subtotal + tax = total, vendor/category references, and possible duplicates.
- [ ] The user explicitly creates the Expense draft through the current route; normal approvals,
      period locks, and posting controls remain intact.

**Implemented (2026-09-14; verification partial):** a `document-extraction` BullMQ queue (a
distinct trust boundary from `automation`, since it handles untrusted document bytes) runs
hash-verify → duplicate-check → ClamAV scan → OCR-support-check → OCR (tesseract.js; PDFs are
rasterized per-page with pdfjs-dist/`@napi-rs/canvas` first) → deterministic regex/heuristic
extraction → persist (`DocumentExtractionService`, `document-extraction.worker.ts`). A failed or
unreachable scan is `SCANNER_UNAVAILABLE` (retried by the worker), never treated as clean; an
infected file is `QUARANTINED` (terminal). `Attachment.contentHash` is computed at upload time;
`DocumentExtraction` persists only hashes and structured candidate fields, never raw OCR text or
the attachment body. Expense and Bill attachment uploads enqueue extraction (now conditional on the
`phase13.document_extraction` flag); `GET/POST .../attachments/:attachmentId/extraction[/accept|
/reject]` let a reviewer accept or reject a candidate — neither route ever creates, updates, or
posts an Expense/Bill itself, satisfying "no parallel posting engine" by construction, not by a
permission check. A generated `search_tsv` column with a GIN index backs
`GET .../documents/search`, with `ts_headline` configured to emit no HTML from untrusted OCR text.
`document-discrepancy.service.ts` compares an accepted candidate's total/currency/date against the
live Expense record. UI: `document-extraction-panel.tsx` (review) and
`document-search-workbench.tsx` (keyword search) both ship, and the web production build renders
them.

**Verification evidence:** `receipt-extractor.test.ts` (13 unit tests — date/currency/amount
parsing, arithmetic validation, vendor/category matching, and the "never invent a value" contract)
and `attachment-validation.test.ts` (13 adversarial unit tests — zip-bomb entry-count/
total-uncompressed-size/compression-ratio rejection against a hand-built ZIP central directory,
encrypted-PDF rejection, content-vs-extension type-spoofing rejection) both pass. Every new route
(extraction GET/accept/reject on both Expense and Bill, document search) is in the
authorization-boundary sweep and passes its 8-role permission matrix, tenant-isolation, and
404-envelope checks.

**Live ClamAV/OCR pipeline proof (2026-09-14):** `docker compose up -d clamav` brought up the
previously-never-started container; `test/phase13-document-extraction-pipeline.int.test.ts`
(4 tests) constructs `DocumentExtractionService` directly (it only lives in the worker module,
which the API test harness doesn't boot) against the harness's real Postgres/MinIO and the real
running ClamAV/tesseract.js backends, then uploads real bytes through the actual HTTP attachment
route and calls `.process()` on the resulting attachment. Proven against real bytes, not
hand-fed OCR text: a clean, valid PNG reaches `READY_FOR_REVIEW` with a real ClamAV engine version
string and a real OCR text hash; the EICAR antivirus test string (a real string every AV engine,
ClamAV included, flags without being actual malware) is quarantined by a genuine ClamAV detection
*before* OCR ever runs (no OCR text recorded); a clean file whose content type isn't OCR-supported
reaches `UNSUPPORTED_FOR_EXTRACTION`, not stuck or failed.

**A real production bug, found and fixed by adding PDF coverage (2026-09-14):** the PDF branch of
the pipeline was completely broken — any real PDF upload would have thrown
`TypeError: CanvasFactory is not a constructor` inside `pdfjs-dist`'s `getDocument()` before a
single page was parsed, because `PdfRasterizerService` passed an already-constructed
`NodeCanvasFactory` *instance* where pdf.js's current API expects the *class itself* (it
instantiates it internally: `new CanvasFactory({ownerDocument, enableHWA})`). Every earlier test
of this code path used hand-fed OCR text, never a real PDF, so this had never actually run. Fixed
in `apps/api/src/documents/pdf-rasterizer.service.ts` by passing the class, not an instance. No
PDF-generation library is a dependency of this repo, so the fixture is a small,
byte-offset-correct hand-built single-page PDF (`test/support/minimal-pdf.ts`) rather than a
placeholder — confirmed independently working before use (real rasterization, real tesseract.js
text extraction) the same way the receipt-image PNG/EICAR fixtures were. The new test case
(`rasterizes a real PDF page and OCRs the rendered image`) reaches `READY_FOR_REVIEW`, asserts the
OCR'd text contains the fixture's known vendor line, and asserts the deterministic extractor
correctly reconciled the fixture's subtotal/tax/total. PDF rasterization is no longer an untested
gap.

### 13E - Required suggestions and advisory insights

- [x] Add categorization candidates and optional approved-rule handoff, variance/anomaly
      insights, and editable draft descriptions/reminders. Persist run and reviewer attribution.
      **Implemented and verified (2026-09-14):** `CategorizationSuggestionService.suggestForVendor()` and
      `DraftNoteService.draftForExpense()` (`purchases/`) and `VarianceInsightService.detect()`
      (`insights/`) are all deterministic (SQL/heuristic, no model call, documented as such in each
      file's own doc comment). The optional approved-rule handoff is deliberately not wired — Phase
      10's `WorkflowRule` conditions/actions engine is noted as the mechanism a future slice would
      use, left out here since the roadmap marks it optional.
- [ ] Add dismiss/correct feedback without using tenant data for model training by default.
      Monitor false positives and correction rates per feature and version.
      **Implemented (2026-09-14):** the generic `AiSuggestion`/`AiFeedback` tables (RLS-backed,
      mirroring `AiRun`/`AiEvidence`'s isolation policy) and `AiSuggestionsStore` back
      `GET .../ai/suggestions` and `POST .../ai/suggestions/:id/{accept,dismiss,correct}`, reused by
      every 13E and 13F-P1 capability that produces a dismissible signal. No training pipeline
      exists to feed tenant data into, so "not used for training by default" holds by omission;
      false-positive-rate and correction-rate monitoring per feature/version is not built.

**Verification evidence:** every route above is in the authorization-boundary sweep (permission
matrix, tenant isolation, 404 envelope), and the `phase13.ai_suggestions` flag's kill-switch and
pilot-rollout behavior is proven end to end in `phase13-feature-flags.int.test.ts` using
`insights/variance` as the exercised route.

**Fixture-based correctness tests (2026-09-14, round 4 — see 13G note below on the earlier
overclaim this corrects):** `test/phase13-insights-fixtures-round3.int.test.ts` (6 tests) proves
`CategorizationSuggestionService.suggestForVendor()` actually returns the vendor's real
majority-vote prior category (2 of 3 posted expenses in one category correctly wins, with exact
`occurrences`/`totalObserved` counts) and correctly returns `null` with no posting history;
`DraftNoteService.draftForExpense()` renders the expense's real recorded facts into the exact
expected string, nothing invented; `VarianceInsightService.detect()` against a real 3-month
baseline correctly flags a >=30%-significant increase and a brand-new category while *excluding* a
real but insignificant (10%) change — the exclusion case is what actually exercises the
significance threshold, not just the flagging path.

### 13F - Additional workflow releases

- [x] P1: bank match proposals, month-end close checklist, duplicate/document discrepancy flags,
      and approval briefings, each using current source/confirmation routes.
      **Implemented and verified (2026-09-14):** `BankMatchProposalService.propose()` ranks candidates by
      amount/date/description overlap and only ever surfaces the existing `Match`/confirm routes —
      it never matches anything itself. `CloseChecklistService.build()`, `DocumentDiscrepancyService`,
      and `ApprovalBriefingService.brief()` (a real field-level diff of
      `ApprovalRequest.targetSnapshot` against the live target's current summary, reusing
      `loadApprovalTarget`/`diffFields`) round out P1. All four ship with matching UI (banking,
      insights, expenses, and approvals workbenches).
- [ ] P2: deterministic cash scenarios, collections prioritization, inventory purchasing and
      project margin advice, versioned country-pack Q&A, and audit evidence packs. Each gets a
      separate evaluation set, permissions, source definition, and release gate.
      **Implemented (2026-09-14):** `CashFlowScenarioService`, `CollectionsPrioritizerService`,
      `InventoryPurchasingAdviserService`, `ProjectMarginAdviserService`, `CountryPackQaService`
      (keyword search scoped to the organization's actually-adopted, versioned `CountryPack`/
      `TaxPack`/`DocumentRule` rows, citing pack code/version on every result), and
      `AuditEvidencePackService` (assembles `AuditEvent` + `Attachment` + `ApprovalRequest` +
      `Journal`/reversal for one entity) all ship, with a matching tabbed UI in
      `insights-workbench.tsx`. **Permission key and release gate split (2026-09-14):** each of the
      six capabilities now has its own independent feature flag
      (`phase13.advisory_insights.{cash_flow,collections,inventory,project_margin,policy_qa,evidence_packs}`,
      migration `20260914080000_split_phase13_advisory_insights_flags`; the old shared
      `phase13.advisory_insights` flag is archived, not deleted) and its own permission key
      (`insights.{cash_flow,collections,inventory,project_margin,policy_qa,evidence_packs}.view`,
      `apps/api/src/organizations/permission-catalog.ts`), each independently rollout-able, pilot-
      narrowable, or kill-switched without affecting the others. Granted to the same roles
      (ADMIN/ACCOUNTANT/VIEWER) that previously held `reports.view` for these routes, preserving
      current effective access exactly. Verified by the full 353-route/8-role authorization-boundary
      sweep (`authorization-boundary.int.test.ts`, 6/6 passing, including the endpoint-discovery
      equality check against the six new permission keys). **Still open:** a **separate evaluation
      set** per capability, as this bullet's own text also asks for — that depends on the 13A
      evaluation-set work below and has not been built yet.

**Verification evidence:** every P1 and P2 route above is in the authorization-boundary sweep
(permission matrix, tenant isolation, 404 envelope). Browser verification against real seeded data
(see 13G) found and fixed a genuine bug in two of these services — `SUM()` over a bigint expression
returning PostgreSQL `numeric`, which Prisma doesn't map back to a real `bigint`, throwing when mixed
into bigint arithmetic — and `test/phase13-insights-bigint.int.test.ts` now covers
`CashFlowScenarioService` and `ProjectMarginAdviserService` against real posted ledger activity
specifically to guard against that regressing.

**Fixture-based correctness tests, round 2 (2026-09-14):** `test/phase13-insights-fixtures.int.test.ts`
(4 tests) covers the two remaining services whose raw SQL reads a bigint column directly —
`InventoryPurchasingAdviserService` (its `SUM(CASE WHEN...)` on-hand/outflow CTEs, already cast to
`::text` in the final SELECT) and `CollectionsPrioritizerService` (a direct `balance_minor` bigint
column, no aggregate) — against real posted stock movements and real overdue invoices, asserting
actual output (days-of-stock-remaining, urgency flag, exposure-score ranking, suggested-action
band), not just "resolves without throwing." Both were confirmed correct; the `::text` cast on
`InventoryPurchasingAdviserService` does mitigate the bigint bug class as inspection suggested it
would, and this is now proven with real data rather than trusted by inspection alone.
**Fixture-based correctness tests, round 3 (2026-09-14):**
`test/phase13-insights-fixtures-round2.int.test.ts` (6 tests) closes out five of the six 13F
services with no raw SQL aggregation (the bigint bug class doesn't apply to them) —
`CloseChecklistService`, `DocumentDiscrepancyService`, `CountryPackQaService`,
`BankMatchProposalService`, and `ApprovalBriefingService` — none of which had a dedicated
real-data correctness test before this pass, only permission/tenant-isolation coverage.
**Correction:** this session's own summary at this point claimed "all thirteen 13E/13F services"
were now covered — that was wrong. It counted only the ten 13F services and missed that
`AuditEvidencePackService` (13F-P2's sixth service) and all three 13E services
(`CategorizationSuggestionService`, `DraftNoteService`, `VarianceInsightService`) were still
untested. See the correctness tests recorded under 13E above and the round-4 note directly below
for how that gap actually closed, and `docs/PHASE13_TODO.html`'s equivalent sections for the
matching correction. No per-capability evaluation set or independently-gated release train exists,
contrary to the P2 bullet's own text above (though its permission-key/flag half is now done — see
the 13F-P2 flag/permission split evidence above).

**Fixture-based correctness tests, round 4 (2026-09-14) — the actual close-out:**
`test/phase13-insights-fixtures-round3.int.test.ts` (6 tests) covers the four services the round-3
summary above incorrectly claimed were already done: `CategorizationSuggestionService` (a real
2-of-3 majority-vote category win, and a correct `null` for a vendor with no posting history),
`DraftNoteService` (exact rendered text from real expense facts), `VarianceInsightService` (a real
3-month baseline correctly flags a significant increase and a brand-new category while excluding
an insignificant one — the exclusion case is what actually proves the 30% threshold, not just the
flagging path), and `AuditEvidencePackService`. Writing a real test for the last one surfaced a
**third genuine production bug this phase**: `AuditEvidencePackService.assemble()` unconditionally
queried `approvalRequest` with `targetType: entityType as unknown as ApprovalTargetType` — but
`EXPENSE`, one of this route's three documented entity types (`EXPENSE`/`BILL`/`INVOICE`), is not
a valid `ApprovalTargetType` value at all (Expenses don't go through the approval-policy system),
so every audit-evidence-pack request for an Expense threw a Prisma validation error before any
other section of the pack could be returned. Fixed in
`apps/api/src/insights/audit-evidence-pack.service.ts` by checking entity-type membership in the
real `ApprovalTargetType` enum before querying, defaulting to an empty array otherwise, instead of
casting past the mismatch. All thirteen 13E/13F services now genuinely have real-posted-data
correctness tests — this time actually true, not just claimed.

### 13G - Acceptance and rollout

- [ ] Add unit, integration, adversarial, and browser tests for every shipped feature. Run the
      repository format, lint, typecheck, unit, integration, migration, build, and relevant E2E gates.
      **Substantially done, not complete (2026-09-14):** `npm run lint` (whole repo),
      `prisma validate`, `prisma migrate status`, both workspaces' `typecheck`, and both workspaces'
      `build` all pass clean. `npm run test --workspace=@retailbooks/api` passes 199/199 (33 new
      this pass: receipt-extractor, attachment zip-bomb/encrypted-PDF/type-spoofing adversarial
      cases, `FeatureFlagGuard`, and a prompt-injection adversarial test). `npm run test:integration
      --workspace=@retailbooks/api` passes 457/457 across 66 files (up from 436/62 on 2026-09-14,
      see below), including a full 8-role permission-matrix/tenant-isolation/404-envelope sweep
      over all 353 organization-scoped routes (26 of them new this pass), a dedicated
      flag-kill-switch/pilot-rollout suite, and a bigint regression suite (below).
      `npm run format:check` reports pre-existing drift in 23 files unrelated to Phase 13
      (marketing pages, the dashboard, a test-support file) — left alone rather than fixed
      opportunistically.

      **Browser verification (2026-09-14):** a first Playwright pass
      (`apps/web/e2e/phase13-ai-workflows.spec.ts`, following the existing `phaseNN-*.spec.ts`
      convention) covers the report Explain panel (deterministic breakdown, AI-unavailable notice,
      keyboard access, Escape-to-close, narrow-viewport layout), all six `insights` tabs, and
      document search — 5 tests, passing across the desktop/tablet/mobile projects each is scoped
      to. Getting there surfaced and fixed real problems, none of them hypothetical:
      - The e2e harness itself was broken in four independent ways that had nothing to do with
        Phase 13 code and had evidently gone unexercised for a while: `prepare.mjs`'s
        `migrate deploy` never set `DATABASE_MIGRATION_URL` (this schema's `directUrl`), so it
        silently migrated the *dev* database instead of `retailbooks_e2e`, leaving that database
        frozen at Phase 12; `apps/web/package.json`'s `start` script pointed at
        `.next/standalone/server.js` when this monorepo's standalone build actually nests it at
        `.next/standalone/apps/web/server.js`; the standalone server never had `.next/static`
        copied into it (Next's standalone mode doesn't do this automatically), so every asset
        would have 404'd; and `playwright.config.ts` passed `--hostname`/`--port` as CLI args to a
        server that only reads `HOSTNAME`/`PORT` env vars, so it always bound to the default
        `0.0.0.0:3000` and the config's own health check just timed out. All four fixed and each
        verified in isolation before relying on them together.
      - `prepare.mjs`'s truncate-then-seed cycle wiped the Phase 13 feature flags (inserted by
        migration) before every run, with nothing to put them back — the same class of problem
        already fixed for the vitest harness in `test/support/app.ts`, just not carried over here.
        Fixed by reseeding the five flags after truncation, mirroring that fix.
      - **A real product bug**, reproducible only against non-empty aggregate data: `SUM()` over a
        bigint expression returns PostgreSQL `numeric`, not `bigint`, and Prisma does not map that
        back to a real JS `bigint` — mixing it into bigint arithmetic throws
        `TypeError: Cannot mix BigInt and other types`. `cash-flow-scenario.service.ts`'s opening
        cash position and `project-margin-adviser.service.ts`'s per-project margin query both had
        this gap; every earlier test for them used a freshly-created, empty organization, where the
        aggregate is always SQL `NULL` and the bug never fires. Fixed with explicit `::bigint`
        casts, matching the pattern already used correctly elsewhere in both files, and covered by
        a new regression suite (`test/phase13-insights-bigint.int.test.ts`) that posts real ledger
        activity specifically to keep this from regressing silently again.
      - While fixing that, found a second, related bug in the same query:
        `project-margin-adviser.service.ts`'s "only show projects with unbilled work" filter
        compared a (mistyped) bigint field to the string `'0'`, which is never `===`/`!==` equal
        regardless of the actual value — the filter was a complete no-op, and the same mistyped
        field would have thrown on `JSON.stringify` in the HTTP response for any organization with
        real project data. Fixed alongside the cast fix; also covered by the new regression suite.

      **Closed since (2026-09-14):** a live-infrastructure round trip through the real ClamAV/OCR
      pipeline (`test/phase13-document-extraction-pipeline.int.test.ts`, 4 tests — real EICAR
      quarantine, real tesseract OCR on both images and a real PDF, real unsupported-type
      handling; closing out the PDF case found and fixed a real production bug, not just added
      coverage — see 13D above); a cross-tenant citation
      adversarial test (`test/ai.int.test.ts`, proving a real evidence-row id from a different
      organization is rejected as an unsupported citation even though it genuinely exists); a
      prompt-injection adversarial test (`test/ai.orchestrator.test.ts` — plants an instruction-like
      payload directly in report evidence text and proves that even a model that fully obeyed it
      (fabricating a citation and a digit-bearing summary) is still rejected by the same
      deterministic validation every answer goes through); fixture-based correctness tests for
      two more advisers (`test/phase13-insights-fixtures.int.test.ts` —
      `InventoryPurchasingAdviserService`, `CollectionsPrioritizerService`); and correctness tests
      for five of the six remaining 13F services with no raw-SQL bigint exposure
      (`test/phase13-insights-fixtures-round2.int.test.ts`, 6 tests —
      `CloseChecklistService` against a real unreconciled account, pending approval, unresolved
      bank transaction, missing-receipt posted expense, and stale draft simultaneously;
      `DocumentDiscrepancyService` against controlled amount/currency/date-mismatch fixtures and a
      fully-matching control case; `CountryPackQaService` against a real adopted
      `CountryPack`/`TaxPack`/`DocumentRule` fixture, covering all three source types and citation
      fields; `BankMatchProposalService` against two real, distinct bank transactions with the
      same amount — verifying the exact score formula and that claiming one via a real `Match` row
      excludes it from a second transaction's proposals; `ApprovalBriefingService` across an
      unchanged-since-submission and a changed-since-submission state on a real Bill). Two real,
      narrow findings surfaced by writing these against actual service behavior rather than
      assumptions: `StatementImportsService.import()` never populates `BankTransaction
      .statementImportId` despite the column existing (not a bug to fix here, just something a
      correctness test needed to work around by querying on `financialAccountId` instead); and two
      CSV rows with identical date/description/amount collapse into one transaction via fingerprint
      deduplication unless their `reference` differs. Together these three test files add 14
      integration tests (436 → 450) and 1 unit test (198 → 199).

      **Correction and actual close-out (2026-09-14):** the "closing out the full set of thirteen"
      language originally here was wrong — round 2 above covered nine of the thirteen 13E/13F
      services, missing `AuditEvidencePackService` (13F-P2's sixth service) and all three 13E
      services (`CategorizationSuggestionService`, `DraftNoteService`, `VarianceInsightService`).
      `test/phase13-insights-fixtures-round3.int.test.ts` (6 tests) closes those four for real,
      and in doing so found a **third genuine production bug** this phase:
      `AuditEvidencePackService.assemble()` crashed for every Expense — one of its three documented
      entity types (`EXPENSE`/`BILL`/`INVOICE`) — because `EXPENSE` is not a valid
      `ApprovalTargetType`, and the code cast past that mismatch (`as unknown as
      ApprovalTargetType`) straight into a Prisma call that then threw a validation error before
      any other section of the pack could be returned. Fixed by checking real enum membership
      first and returning no approval requests for entity types the approval system doesn't cover,
      rather than casting past the type system's own warning. Adds 6 more integration tests
      (450 → 457). All thirteen 13E/13F services now genuinely have real-posted-data correctness
      tests.

      **E2E specs written, not yet run (2026-09-14):**
      `apps/web/e2e/phase13-workflow-actions.spec.ts` covers all four remaining UI surfaces —
      document extraction accept and dismiss, document discrepancy detection, bank match
      proposals, and the approval briefing's "changed since submission" state — each seeding real
      backend state via direct API calls (`apps/web/e2e/lib/api-fixtures.ts`; the demo seed data
      has none of these: no bank transactions, approval requests, AI suggestions, or document
      extractions) rather than mocking anything. The document-extraction tests required actually
      fixing a real harness gap: the `document-extraction` BullMQ worker was never started for
      E2E at all (only the API and web servers were), so an uploaded file's `DocumentExtraction`
      row would have sat at `PENDING` forever — fixed by spawning it as a detached background
      process from `prepare.mjs` once the build it depends on has finished (`webServer` array
      entries start concurrently and have no way to depend on a sibling's build step, so a third
      concurrent entry would have raced the build). A synthetic receipt image renderer
      (`apps/web/e2e/lib/receipt-image.ts`, using `@napi-rs/canvas`) was smoke-tested end-to-end
      through the real tesseract.js OCR before being relied on. All new/changed files pass
      typecheck and lint. **Not yet run against live infrastructure**: the local machine had only
      1.3GB of 15.7GB RAM free (unrelated concurrent work on the same machine, not anything this
      session started), and the E2E harness's `nest build` step needs more than that — it failed
      with an out-of-memory crash twice in a row. Per the user's explicit decision, this is left
      for a later run once memory is available (`npx playwright test
      phase13-workflow-actions.spec.ts --project=desktop` from `apps/web`) rather than claimed as
      verified now.

      **Still not done:** 13A's threat model, 100-item evaluation set, and frozen-holdout quality
      gates (first-pass drafts exist, not yet human-reviewed — see 13A above); and running the new
      E2E specs against live infrastructure (written and
      typecheck/lint-clean, blocked on local machine memory — see above).
- [x] Roll out behind per-organization feature flags: internal synthetic data, pilot tenants in
      private mode, then broader availability. Keep an immediate kill switch and model/version
      rollback. Do not turn on hosted mode as a side effect of a feature flag.
      **Implemented and verified (2026-09-14):** `FeatureFlagGuard`/`RequireFeatureFlag`
      (`platform/feature-flag.guard.ts`) reuse Phase 12's `FeatureFlag`/`FeatureFlagRule`/
      `EntitlementsService` rather than building new infrastructure. Five capability-group flags
      (`phase13.report_drilldown`, `.document_extraction`, `.ai_suggestions`,
      `.approval_automation`, `.advisory_insights`) gate every 13C-13F route, seeded ACTIVE +
      default-enabled via migration `20260914060000_seed_phase13_feature_flags` — matching the
      "internal synthetic data" rollout stage this environment is at. An unknown, archived, or
      explicitly-disabled flag fails closed (403), proven end to end in
      `phase13-feature-flags.int.test.ts`: reachable by default, an immediate kill switch via
      `defaultEnabled`, fail-closed on `ARCHIVED` (not treated as still-on), and a pilot-tenant
      rollout (off globally, on for one organization via an `ORGANIZATION`-scope `FeatureFlagRule`,
      confirmed still off for a second organization) all pass. No hosted-mode configuration was
      touched by any of this work. "Model/version rollback" already exists as the pre-existing
      `AI_MODE`/gateway-descriptor configuration from 13B; nothing new was needed for it.
- [ ] Update `docs/BUILD_ROADMAP.md` and `docs/GAPS.md` only as capabilities actually pass their
      acceptance tests; attach results and operational runbooks to this checklist.
      **Deliberately not done yet:** several gates above (browser/E2E, 13A's evaluation holdouts,
      the live-infrastructure document-pipeline round trip) remain open, so `BUILD_ROADMAP.md` and
      `GAPS.md` stay unchanged per this bullet's own rule.

## Non-negotiable acceptance gates

| Area            | Release evidence                                                                                                                                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Financial truth | Every displayed financial amount has exact equality with a backend-calculated value under recorded filters and currency; golden report/reconciliation scenarios pass. No amount comes only from model prose.                                                        |
| Grounding       | Every factual citation resolves to a current, authorized source or report drill-down. Unsupported claims and missing evidence result in abstention; no fabricated IDs or URLs reach the UI.                                                                         |
| Isolation       | Cross-tenant, cross-role, suspended, revoked, portal, background-job, index, and citation-open tests show zero unauthorized disclosure. RLS is tested with the actual production-style runtime role.                                                                |
| Actions         | Zero model-originated ledger or financial-commitment writes. Acceptance requires a live authorized user, fresh source/version checks, and the existing domain validation/audit path.                                                                                |
| Privacy         | Private mode makes zero public model/embedding/OCR requests. Hosted-limited mode is disabled until its reviewed terms, tenant choice, egress policy, data minimization, and log tests pass.                                                                         |
| Quality         | Report supported-intent accuracy, retrieval recall, extraction precision by field, false-positive rate, and appropriate abstention are measured on frozen holdouts. Set feature-specific minimums before rollout; narrow supported intents when a target is missed. |
| Resilience      | Provider outage, malformed/empty JSON, timeout, stale index, corrupted document, and partial worker failure fail closed with a retry or manual workflow, never a fabricated answer or duplicate action.                                                             |

The practical rule for the entire phase: the application computes and authorizes; retrieval supplies
evidence; DeepSeek interprets and drafts; a person reviews consequential actions.
