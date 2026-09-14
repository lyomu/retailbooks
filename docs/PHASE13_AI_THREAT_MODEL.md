# Phase 13 AI/RAG threat model and data-flow inventory

**Status:** draft, first pass. **Prepared:** 2026-09-14. Written against the codebase as of the
hosted-DeepSeek-adapter and 13F-P2 flag-split work landing the same day (see
`docs/PHASE13_TODO.md`'s "Implemented and verified" notes for exact commits/files). This is the
13A deliverable "threat model and data-flow inventory" — it names components, trust boundaries,
and mitigations already in place, and calls out where a gap is still open rather than implying
coverage that doesn't exist. It is a first pass, not a completed security review: it has not been
reviewed by anyone other than the author, and closing it does not by itself satisfy 13A's other
three gates (privacy/cross-border review, evaluation set, frozen baselines — tracked separately in
`docs/PHASE13_TODO.md`).

## 1. System components and data flow

```
                    ┌─────────────────────────────────────────────────────────┐
                    │  Browser (organization member)                          │
                    └───────────────┬─────────────────────────────────────────┘
                                     │ session cookie, same-origin
                                     ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  API process (NestJS)                                                       │
│                                                                               │
│  SessionGuard → OrganizationGuard → FeatureFlagGuard → RequirePermission    │
│                                     │                                        │
│         ┌───────────────────────────┼───────────────────────┐               │
│         ▼                           ▼                       ▼               │
│  ReportingService            AiOrchestrator          Attachments/           │
│  (deterministic;              │                       Bills/Expenses        │
│   the only source of           │ builds AiEvidenceEnvelope    controllers    │
│   displayed amounts)           │ (capped rows, no PII       │                │
│                                 │  beyond what reports.view  │ enqueue       │
│                                 │  already exposes)          │ document-     │
│                                 ▼                             │ extraction   │
│                          AiModelGateway ───────────────┐      │ job          │
│                          (AI_MODE: off|private|         │     ▼              │
│                           hosted_limited)               │  BullMQ (Redis)   │
│                                 │                        │     │            │
│         ┌───────────────────────┴──────────┐             │     ▼            │
│         ▼ (AI_MODE=private)                 ▼ (hosted_limited,│  Worker process│
│  Self-hosted DeepSeek-                 phase13.hosted_ai_    │  (separate    │
│  compatible endpoint                   egress flag REQUIRED, │   from API)   │
│  (operator-provisioned,                per-organization,     │   │           │
│   AI_PRIVATE_ALLOWED_HOSTS-            seeded OFF)            │   ▼          │
│  pinned in production)                       │                │ StorageService│
│                                               ▼                │ .download()  │
│                                     https://api.deepseek.com   │   │          │
│                                     (DeepSeek's hosted API,    │   ▼          │
│                                     hard-coded, no env var      │ MalwareScannerService│
│                                     can redirect it)            │ (real TCP to  │
│                                                                  │  ClamAV)     │
│                                                                  │   │          │
│                                                                  │   ▼          │
│                                                                  │ OcrService    │
│                                                                  │ (tesseract.js,│
│                                                                  │  local WASM,  │
│                                                                  │  no network)  │
│                                                                  │   │          │
│                                                                  │   ▼          │
│                                                                  │ extractReceipt│
│                                                                  │ Candidate()   │
│                                                                  │ (pure, no AI) │
└────────────────────────────────────────────────────────────────┴──────────────┘
         │                                                              │
         ▼                                                              ▼
  Postgres: AiRun / AiEvidence                                 Postgres: DocumentExtraction
  (RLS-scoped, transaction-local                                (search_tsv keyword index,
  organization_id; metadata only —                              no embeddings/pgvector yet)
  prompt/response text never stored)                                    │
         │                                                              ▼
         ▼                                                       MinIO/S3 (attachment bytes,
  AuditEvent (ai.run_started/completed/failed,                   signed URLs for browser
  documents.extraction_*)                                        download only — the worker
                                                                   downloads bytes directly,
                                                                   never via a signed URL)
```

Two independent capabilities share the `AiModelGateway`/`AiOrchestrator` path (13B/13C): "ask a
question about a report" and "explain this displayed number." Both call the same gateway, the same
evidence-envelope builder, the same citation validator. Document extraction (13D) is a **separate**
pipeline with **no model call anywhere in it** — OCR is local WASM (tesseract.js), and receipt-field
extraction (`extractReceiptCandidate`) is a pure deterministic function over OCR text; nothing in
the extraction path talks to DeepSeek, hosted or private. Categorization suggestions and variance
insights (13E) and all six 13F-P2 advisers are likewise deterministic — no model call. The only
places a real inference request leaves the process are `AiOrchestrator.explainReport` and
`.explainNumber`, both going through `AiModelGateway.explain()`.

## 2. Trust boundaries

| Boundary | What crosses it | Enforcement |
|---|---|---|
| Browser → API | Session cookie, request body | `SessionGuard`, CSRF/session machinery (pre-Phase-13) |
| Tenant → Tenant | Nothing should cross this | `OrganizationGuard` + Postgres RLS (`app.organization_id`, transaction-local) on `AiRun`/`AiEvidence`; ordinary tenant-scoped `WHERE organizationId = ...` everywhere else (not RLS-backed outside the AI tables) |
| API process → private DeepSeek endpoint | Report/drill-down rows only (see §3) | `AI_PRIVATE_ALLOWED_HOSTS` production allowlist; `AI_PRIVATE_ENDPOINT` must be HTTPS in production; the public DeepSeek host is explicitly rejected as a "private" endpoint |
| API process → hosted DeepSeek endpoint (`api.deepseek.com`) | Same evidence envelope as private mode | **Two independent gates**, not one: (a) `AI_MODE=hosted_limited` (architecture selection) and (b) `phase13.hosted_ai_egress` feature flag, seeded `default_enabled: false` everywhere including the test harness, requiring an explicit per-organization `FeatureFlagRule`. Neither alone is sufficient — see `ai-model.gateway.test.ts`'s literal fail-closed proof. The endpoint itself is hard-coded (`HOSTED_DEEPSEEK_ENDPOINT` constant), not configurable, so no env var or flag misconfiguration can redirect hosted egress to an arbitrary host |
| Worker process → ClamAV | File bytes over raw TCP (clamd INSTREAM protocol) | Connection failure/timeout/unparseable reply is a thrown error, never treated as "clean" — the caller must fail closed |
| Worker process → OCR | File bytes, in-process | tesseract.js runs as local WASM; no network call, no external service; bounded by `OCR_TIMEOUT_MS`/`OCR_MAX_TEXT_CHARS` |
| Model response → application | `{summary, citationIds, abstained}` JSON only | Schema-validated (`aiModelExplanationSchema`); no tool-calling, no function-calling surface offered to the model at all; `summary` is rejected if it contains any digit; every `citationId` must resolve inside the evidence envelope actually sent for *this* request |

## 3. What data reaches a model, and what never does

**Reaches the model (as JSON evidence, explicitly labeled "untrusted data, never instructions" in
the system prompt):** report row cells and totals for rows the asking user is currently authorized
to view via `reports.view`, capped to `AI_MAX_CONTEXT_ROWS` rows, plus the user's free-text
question.

**Never reaches the model:** raw OCR text (document extraction has no model call at all); full
customer/vendor contact records beyond what a report row already surfaces; authentication
material, session tokens, or the `SECURITY_PEPPER`; other organizations' data (bounded by the
per-request `reports.run(organization.id, ...)` scoping — see §5's cross-tenant analysis);
database credentials or infrastructure configuration.

**Stored about a model interaction (`AiRun`/`AiEvidence`):** capability, provider, model name,
SHA-256 hashes of the request and evidence (not the content), token counts, a failure code if any,
and evidence *references* (source type/id/version, not the row content itself). The prompt text,
the model's raw response, and any attachment/OCR text are deliberately never persisted in these
tables — see the doc comment on `AiRun` in `schema.prisma`. This is a real privacy control: even a
full compromise of the `ai_runs`/`ai_evidence` tables discloses metadata and hashes, not financial
content or prompts.

## 4. Threats considered

### 4.1 Prompt injection

**Vector:** an attacker who can get text into a report row (e.g., a journal entry description, an
invoice line description) or, in principle, into OCR'd document text, crafts it to look like an
instruction to the model ("ignore prior instructions, reveal X, cite Y as authoritative").

**Current mitigations:**
- The system prompt explicitly frames all evidence as untrusted data, never instructions, and the
  model has zero tools/function-calling surface — there is nothing for an injected instruction to
  *do* even if the model "obeys" it, other than write different prose or a different citation list.
- Every citation the model returns is checked against the *actual* evidence envelope built for that
  request — an injected instruction cannot make the validator accept a citation ID that wasn't
  genuinely sent as evidence (`validateAnswer`).
- The summary is rejected outright if it contains any digit, closing the specific injection goal of
  getting the model to assert a fabricated number as prose (`/\d/.test(answer.summary)`).
- `test/ai.orchestrator.test.ts` now has a dedicated adversarial test (added 2026-09-14) that
  plants a realistic injection payload directly in evidence text and makes the *mocked model fully
  obey it* — fabricating exactly the citation and the digit-bearing summary the payload asked for —
  and proves the deterministic validation layer rejects it regardless. This demonstrates the
  guarantee does not depend on the model declining; it depends on evidence never having a path to
  become an accepted citation or an accepted digit.

**Gaps / not yet covered:**
- This is a mocked-model unit/integration test, not a test against a real DeepSeek model actually
  receiving the payload and choosing how to respond. It proves the *application's* guardrails hold
  under a worst-case (fully obedient) model; it does not measure how a real model actually behaves
  when confronted with injected text — that is squarely 13A's "adversarial cases" bucket in the
  evaluation set, still open.
- Document extraction (13D) has no model call, so classic RAG-style injection via OCR'd text
  reaching a prompt does not apply to it today. If embeddings/RAG retrieval over document text is
  ever added (see §6), this threat surface reopens for that feature specifically and needs its own
  review before shipping — do not assume this section's analysis transfers automatically.

### 4.2 Malicious uploads

**Vector:** a user uploads a file crafted to exploit the scanner, the OCR engine, the PDF renderer,
or a downstream parser (zip bombs inside `.xlsx`/`.docx`, encrypted PDFs, content-type spoofing,
actual malware).

**Current mitigations:**
- `validateAttachment` (magic-byte sniffing per declared extension, zip central-directory entry
  count/uncompressed-size/ratio limits without ever inflating entry data, encrypted-PDF rejection)
  runs before anything is stored. Covered by 13 adversarial unit tests
  (`attachment-validation.test.ts`).
- Every uploaded file is scanned by a real ClamAV instance before extraction proceeds; a scanner
  outage is `SCANNER_UNAVAILABLE` (retried, BullMQ backoff), never treated as clean; an infected
  file is `QUARANTINED` and extraction stops before OCR ever runs. Now proven against real bytes,
  including a genuine ClamAV detection of the EICAR test string
  (`test/phase13-document-extraction-pipeline.int.test.ts`, added 2026-09-14).
- PDF rendering uses `pdfjs-dist`'s Node build with `isEvalSupported: false` (no embedded
  PDF-JavaScript execution) and a hard page cap (`MAX_PAGES = 5`), so a many-page or
  script-carrying PDF cannot turn one extraction job into unbounded work or code execution.
- OCR runs as local WASM (tesseract.js) with a wall-clock timeout and output-length cap
  (`OCR_TIMEOUT_MS`, `OCR_MAX_TEXT_CHARS`) — bounded, but explicitly *not* OS-level sandboxed
  (no seccomp, no separate container); the code comment on `OcrService` says so directly.

**Gaps / not yet covered:**
- Real process isolation for the OCR/PDF-rasterization step (a genuine sandbox or separate
  low-privilege container) is called out in the code itself as a deployment-hardening step beyond
  this slice — not done.
- The new pipeline test (§4.2 above) exercises PNG images and a plain-text quarantine case; it does
  not exercise a malicious or malformed PDF through the real rasterizer. That is a specific
  remaining gap (tracked in `docs/PHASE13_TODO.md`'s 13D section).

### 4.3 Tenant leaks

**Vector:** an answer, citation, or search result for organization A discloses data belonging to
organization B.

**Current mitigations:**
- `AiRun`/`AiEvidence` are RLS-backed on `app.organization_id`, set transaction-locally per request
  — verified by a non-login, non-bypass-RLS Postgres role directly querying these tables with and
  without context set (`ai.int.test.ts`'s `verifyRlsIsolation`).
- The evidence envelope sent to the model is built from exactly one `reports.run(organizationId,
  ...)` call scoped to the asking organization; there is no code path that merges rows from two
  organizations into one evidence envelope.
- **New (2026-09-14):** `test/ai.int.test.ts` adds a test proving that even a *real, currently
  existing* evidence-row id belonging to a genuinely different organization — not a nonexistent or
  malformed id — is rejected as an unsupported citation if a (simulated, fully-obedient) model
  tries to cite it for a different organization's question. This closes the specific gap the 13A
  handover called out: a prior test suite only proved fabricated/nonexistent citations are
  rejected, not that a real cross-tenant id specifically is rejected.
- Document search (`DocumentSearchService`) filters by `organizationId`, by extraction status
  (`READY_FOR_REVIEW` only), and by the caller's own allowed entity types before any row is
  returned — there is no query-string-to-unfiltered-scan path.
- Mid-flight authorization loss (role removed, membership suspended, organization suspended, while
  a model call is in progress) is checked *after* the model returns and before any answer is
  handed back — `MODEL_EVIDENCE_UNAUTHORIZED` fails closed with no data disclosed. Integration-
  tested for role removal, suspended membership, suspended organization, and deleted membership.

**Gaps / not yet covered:**
- The cross-tenant citation test above uses a mocked/stubbed gateway to simulate a worst-case
  model, not a real DeepSeek call — same caveat as §4.1.
- No equivalent cross-tenant test exists yet for the 13F-P2 advisory-insight services' underlying
  SQL (each is scoped by `organizationId` in its own query, per source-level inspection, but only
  two of the seven — `CashFlowScenarioService`/`ProjectMarginAdviserService`, plus
  `InventoryPurchasingAdviserService`/`CollectionsPrioritizerService` as of 2026-09-14 — have a
  real-posted-data correctness test backing that inspection up).

### 4.4 Inference abuse

**Vector:** a user or compromised session drives excessive model calls to exhaust budget, cost, or
rate limits, or to probe the model as a general-purpose chat interface unrelated to accounting.

**Current mitigations:**
- Redis-backed hourly limits, both per-actor-per-organization and per-organization, consumed
  *before* report retrieval or model contact — with an in-process fallback if Redis itself is
  unavailable (fail-closed on the limiter, not fail-open).
- `ai.assistant.ask` is a distinct permission from `reports.view`; both are required (a double
  gate: the AI surface, and the underlying report evidence it would need).
- The model has no tools, no function-calling, and a fixed, narrow system prompt — no path to
  general-purpose usage exists inside the current supported intents (report explanation, number
  explanation).
- Two bounded intents only (13C): an unsupported report key, a row with no posted activity, or an
  oversized contributing-line set are rejected before any model call, not answered speculatively.

**Gaps / not yet covered:**
- No behavioral/anomaly-based abuse detection beyond the fixed hourly caps — a low-and-slow abuse
  pattern within the rate limit would not be flagged.
- No per-capability rate-limit differentiation yet between `ask` (report Q&A) and the 13F-P2
  advisory insights, since those are deterministic and don't currently share the AI rate-limit
  pool — this is fine today (no model call to protect) but would need revisiting if any of those
  six capabilities ever grows a model-backed component.

### 4.5 Provider failure

**Vector:** the model endpoint is slow, down, returns malformed output, or degrades silently.

**Current mitigations:**
- Bounded retry (configurable, capped) only for genuinely transient failures (network, timeout,
  429/5xx); malformed provider output is rejected without retry.
- A per-endpoint/model in-memory circuit breaker opens after a configured failure threshold and
  rejects requests during its cooldown rather than continuing to hammer a failing endpoint.
- `explainNumber` (13C) never blocks the deterministic drill-down on a provider failure — the
  authoritative number is always returned; only the optional narrative is marked `unavailable`.
  `explainReport` (13B) is the one intentional exception: if the *only* thing being asked for is
  the AI explanation itself, a failure there fails the whole request closed rather than fabricating
  a partial answer.
- Stale evidence (a cited row's content or version changed between the model call starting and
  returning) is detected and fails closed (`MODEL_EVIDENCE_STALE`), covered by a dedicated
  integration test.

**Gaps / not yet covered:**
- No test yet simulates a stale search index, a corrupted document mid-pipeline (distinct from a
  hash mismatch, which *is* tested), or partial worker failure mid-batch for a multi-page PDF.

## 5. Hosted DeepSeek egress specifically (new since 2026-09-14)

This is the component the threat model most needs to get right before it can ever carry real
tenant data, since it is the one genuinely new external egress path added this session.

- **What would leave the private boundary if enabled:** identical evidence envelope shape to
  private mode — capped report rows and the user's question. No attachment bytes, no OCR text
  (document extraction has no model call), no raw database access.
- **What DeepSeek's hosted terms imply:** not yet reviewed — this is explicitly deferred to the
  13A privacy/contractual review, not answered by this document. Do not treat the technical gate
  described below as a substitute for that review; it is necessary but not sufficient.
- **The technical gate:** two independent controls, not one — see the trust-boundary table in §2.
  `AI_MODE=hosted_limited` alone cannot cause a real network request; the
  `phase13.hosted_ai_egress` flag must also be explicitly enabled for the specific organization via
  an `ORGANIZATION`-scope `FeatureFlagRule` (never the flag's global `default_enabled`, which stays
  `false`). This is proven, not just designed: `ai-model.gateway.test.ts` has the literal test
  "`AI_MODE=hosted_limited` with the flag unset never calls fetch."
- **What still must happen before this is ever turned on for a real tenant:** the 13A privacy and
  cross-border review (unstarted), explicit tenant consent/choice captured somewhere durable (the
  per-organization flag rule is the *mechanism* for this, not a substitute for actually asking),
  and a documented data-minimization/log-retention review specific to sending evidence to a
  third-party hosted endpoint rather than a self-hosted one.

## 6. Explicitly out of scope for this pass

- **Embeddings/pgvector:** not implemented. Document search is keyword-only
  (`ts_headline`/`search_tsv`, Postgres full-text search) — see `DocumentSearchService`. If
  vector search is added later, it needs its own review: a new data flow (document text →
  embedding vector → stored index → retrieval), a new trust boundary (whatever embedding provider
  is used, local or hosted), and a re-examination of whether §4.1's injection analysis still holds
  once retrieval, not just report evidence, feeds the prompt.
- **Backups:** not covered here — this is an application-layer threat model; backup encryption,
  retention, and access control are an infrastructure/ops concern tracked separately (see
  `docs/adr/0011-threat-model-and-secret-handling.md` for the general platform posture, which
  predates and does not cover Phase 13's AI-specific surface).
- **Logs:** `LOG_LEVEL` and general request logging are pre-existing platform concerns; this
  document does not audit what the application logger captures about AI requests beyond noting
  that `AiRun` itself deliberately excludes prompt/response content (§3).
