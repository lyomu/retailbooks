# RetailBooks — Open Gaps Tracker

**How to use this file:** every item below is a checkbox. Check an item off (`- [ ]` → `- [x]`)
only when it is actually implemented and verified (tests passing, not just code written) — same
rule as `docs/BUILD_ROADMAP.md`. **After every update to this project that touches one of these
items, come back and update this file in the same commit as the work** — do not let it drift the
way `EXECUTION_PLAN.md`'s own checkboxes did (see section G, which exists only because that rule
was skipped once). If a checked item later turns out to be wrong or regresses, uncheck it and say
why inline. Keep the "snapshot" date below current.

Source of truth for scope remains `docs/BUILD_ROADMAP.md`; this file is a flat, prioritized,
checkable list of everything still open across the whole project, pulled from the roadmap,
`docs/EXECUTION_PLAN.md`, `docs/HANDOVER.md`, and the individual `docs/PHASE<N>_TODO.md` files,
cross-checked against the code and the latest captured gate logs.

**Snapshot:** 2026-09-12. **Branch note:** `chore/verification-closure` is 35 commits ahead of
`main` with nothing behind — Phases 10, 11, and 12 are not yet on `main`.

---

## A. Unbuilt phases

### A1. Phase 13 — AI Layer (no code exists)

No `apps/api/src/ai` module; zero AI-related identifiers anywhere in `apps/` or `packages/`.
(`docs/BUILD_ROADMAP.md:804-823`)

- [ ] 1. Receipt extraction — candidate vendor/date/amount/tax/category; user must review before
      creating/posting (feeds Phase 3 Expenses)
- [ ] 2. Ask your books — permission-filtered natural-language query over the Phase 9 report engine
- [ ] 3. Explain a number — trace a report figure back to report rows and source transactions
- [ ] 4. Categorization suggestions — suggestion only, unless an explicit user-approved rule exists
      (feeds Phase 10's rule engine)
- [ ] 5. Variance/anomaly insights — advisory, explainable, dismissible
- [ ] 6. Draft text — descriptions/reminders only, no autonomous financial commitment
- [ ] 7. _Acceptance:_ every suggestion attributable to a specific model/run; requires explicit
      user confirmation before any ledger-impacting action
- [ ] 8. _Acceptance:_ AI queries respect the same permission scoping as underlying data (no
      cross-tenant leakage through the NL query path)

### A2. Phase 14 — Hardening & Release (not started)

Nine tracks, run incrementally then fully before public V1. (`docs/BUILD_ROADMAP.md:828-844`)

- [ ] 9. Accounting: golden scenario suite, balanced ledger, subledger/control-account
      reconciliation, period locks, FX cases
- [ ] 10. Tenant isolation: automated cross-org authorization tests across API, exports, portal,
      jobs
- [ ] 11. Security: auth/session/MFA, rate limits, secret handling, dependency scanning, file
      validation, admin controls
- [ ] 12. Reliability: backup/restore drill, queue retry/idempotency, disaster procedures,
      observability
- [ ] 13. Performance: large lists, imports, reports tested with production-like data volumes
- [ ] 14. Accessibility: critical journeys keyboard-usable and WCAG 2.2 AA-oriented
- [ ] 15. Migration/import: customers, vendors, items, opening balances, core transaction import
      paths
- [ ] 16. Operations: monitoring, alerts, runbooks, support/admin tools ready
- [ ] 17. Launch: terms/privacy/compliance claims reviewed, selected country packs signed off

---

## B. Cross-module acceptance scenarios — all 8 proven

(`docs/BUILD_ROADMAP.md:848-865`). All eight are now covered by integration scenarios.

- [x] 1. Quote → acceptance → invoice → partial + final payment → bank import/match → reconcile →
      P&L/AR/GL agree. Proven end to end by
      `apps/api/test/cross-module-scenarios.int.test.ts`.
- [x] 2. Purchase inventory → vendor bill → payment → stock receipt → sale/invoice → stock
      issue/COGS → customer payment → inventory valuation agrees to GL — proven by
      `apps/api/test/inventory.int.test.ts`
- [x] 3. Project → approved time + expense → generate invoice → record payment → profitability and
      ledger reconcile — proven by Phase 7
- [x] 4. Credit flow: invoice → partial payment → credit note → allocate credit → remaining
      balance correct in statement, AR aging, and GL. Proven end to end by
      `apps/api/test/cross-module-scenarios.int.test.ts`.
- [x] 5. Foreign currency: foreign invoice → payment at different rate → realized FX gain/loss
      posted → base-currency reports balance. Proven end to end by
      `apps/api/test/cross-module-scenarios.int.test.ts`.
- [x] 6. Close period: reconcile → lock → backdated edit/post attempt fails → authorized unlock
      records actor/reason → re-lock succeeds. Proven end to end by
      `apps/api/test/cross-module-scenarios.int.test.ts`.
- [x] 7. Approval: maker creates → cannot issue before approval → approver rejects → maker
      edits/resubmits → approver approves → issue/post → complete history. Proven end to end by
      `apps/api/test/cross-module-scenarios.int.test.ts`.
- [x] 8. Tenant security: identical record IDs/guesses from another organization never disclose
      existence or data. Proven end to end by `apps/api/test/cross-module-scenarios.int.test.ts`.

---

## C. Phase 10 tracked debt — 12 open items

All in `docs/PHASE10_TODO.md`, each honestly annotated "partial" or "not done":

- [ ] 18. **10A** (`:125`) — shared enums + discriminated Zod contracts for event envelopes/
      approval targets/triggers/schedules/jobs/notifications (partial)
- [ ] 19. **10B/10E** (`:272`, `:286`) — `runDueTemplates` still public; each recurring template
      advances its own `nextRunDate` through a separate calendar implementation, a second source
      of truth alongside the scheduler
- [ ] 20. **10C** (`:180`) — `submitter role` criteria condition unresolved
- [ ] 21. **10C** (`:190`) — no per-type state-machine documentation for the nine approval targets
- [ ] 22. **10C** (`:206`) — Quote's bespoke `sales.quotes.approve` flow runs fully independently
      of the policy engine, not as an adapter into it
- [ ] 23. **10D** (`:231`) — registered non-financial field-update action (partial)
- [ ] 24. **10F** (`:312`) — `ReportArtifactService#generate` still buffers the whole artifact; no
      transport-neutral stream interface
- [ ] 25. **10F** (`:334`) — oversized interactive PDF exports don't route through a worker with
      `202 Accepted` + job-status resource
- [ ] 26. **10H** (`:419`) — approval edge-case tests: multi-level ordering, criteria boundaries,
      concurrent decisions, policy edits mid-flight, revoked permissions (sections 1-7 of
      `docs/PHASE10_TEST_PLAN.md` landed; this is the remainder)
- [ ] 27. **10I** (`:480`) — worker/environment ops documentation (queue names, concurrency,
      lease, retry, retention, cleanup, recovery)
- [ ] 28. **10I** (`:482`) — operator-facing runbook collecting the event catalog, approval target
      matrix, action registry, misfire semantics, retry procedure

---

## D. Phase 1 / foundation debt

- [x] 29. **Startup environment validation** — ADR 0011 follow-up. `@retailbooks/config` now
      validates the API/worker environment at Nest startup, supplies local/test defaults, and
      rejects missing or localhost `DATABASE_URL`, `REDIS_URL`, and `S3_*` values in production.
      Verified with the config unit tests, API unit tests, and API typecheck. (`docs/PHASE1_TODO.md:380`)
- [ ] 30. Visual-regression baselines against the RetailFlow references — currently 2 screenshots
      per breakpoint (deferred to Phase 14 by decision — Stage 4.5)
- [ ] 31. Visual regression at desktop/tablet/mobile breakpoints (deferred to Phase 14 — Stage 4.6)
- [ ] 32. WCAG 2.2 AA keyboard/screen-reader/contrast/focus review across the full surface
      (deferred to Phase 14 — Stage 4.7)
- [ ] 33. Backup/restore drill + operational runbooks (deferred to Phase 14 — Stage 4.8)

Items 30-33 are deferred _by decision_, not drift (`docs/EXECUTION_PLAN.md:196-203`) — they overlap
directly with Phase 14 tracks 13-16 above and should close together, not twice.

---

## E. Platform-wide contracts never closed

(`docs/BUILD_ROADMAP.md:101-112`) — cross-cutting non-negotiables no phase ever ticked:

- [x] 34. Idempotency keys on **every** posting endpoint (invoice issue, bill posting, payment,
      etc.)
      Verified across the posting surface; inventory adjustment posting, inventory transfers, and
      purchase-order receipts now replay cleanly through dedicated idempotency namespaces and are
      covered by `apps/api/test/inventory.int.test.ts` and
      `apps/api/test/purchase-orders.int.test.ts`.
- [ ] 35. Optimistic concurrency / version fields on high-risk financial records beyond the ledger
- [x] 36. Domain event emission for the full catalog (`invoice.issued`, `invoice.voided`,
      `payment.recorded`, `bill.posted`, …)
      Scheduled job completion/failure now emit catalog events transactionally and are covered by
      `apps/api/test/scheduler-sweep.int.test.ts`; registry coverage remains in
      `apps/api/test/domain-event-registry.test.ts`.
- [x] 37. Background consumers retry-safe and idempotent for every queue (email queue already is)
      Workflow and scheduler consumers now guard every run with an idempotency key written inside the
      same transaction that advances the execution row, so a BullMQ replay/retry can never re-apply
      side effects. Covered by `apps/api/test/workflow-rules.int.test.ts` (resume-on-retry,
      replay-after-completion no-op) and `apps/api/test/scheduler-sweep.int.test.ts` (re-claim on
      crash, re-run on failure, no-op after commit).
- [x] 38. PDFs generated from immutable snapshots of issued documents
      `buildPdfRenderSnapshot()` in `apps/api/src/sales/pdf-render-snapshot.ts` captures the exact
      display payload (org name, contact name, number, dates, currency, totals, per-line data) inside
      the issue/approval transaction, written to the document row's `pdfSnapshot` JSONB column. The
      send/portal paths render from this payload -- never from live records -- so renaming a customer
      or restyling an organization after issue can never restate the issued document. Covered by
      `apps/api/test/issued-document-snapshots.int.test.ts` (invoice, quote, credit note).

_(Explicitly out of scope for V1 per spec §19, not a gap: public API/webhook contracts.)_

- [x] 39. **Shared screen patterns** — all 6 pattern contracts (List, Create/Edit, Detail, Import,
      Approval, Report) at `docs/BUILD_ROADMAP.md:132-161` are satisfied by shipped screens.
      Audited against `apps/web/src/components/*-workbench.tsx` — every pattern has a canonical
      implementation (invoices-workbench.tsx for List/Create/Edit/Detail, banking-workbench.tsx
      for Import, approvals-workbench.tsx for Approval, reports-workbench.tsx for Report) and
      is reused across 15+ entity workbenches. All required states (loading, empty, error,
      no-permission, archived/void, success) are handled via shared primitives from `packages/ui`.
- [x] 40. **Definition of Done** template (`docs/BUILD_ROADMAP.md:907-921`) run per-module.
      Audit result: 11 of 14 DoD items are satisfied across all shipped modules; 3 are deferred to
      future phases by decision: - **Analytics events** — feeds Phase 12 Product Analytics (no code exists yet; `apps/web/src/components/platform-overview.tsx` shows org-level adoption metrics only, not product event instrumentation) - **Documentation/support notes** — Phase 14 track 16 Operations (not started; each phase has a `PHASE<N>_TODO.md` as implementation reference but no runbooks/support notes exist) - **Accessibility and security checks** — Phase 14 tracks 11 & 14 (not started)
      Satisfied items: product requirements (per-phase TODOs), UX states (`packages/ui` EmptyState/ForbiddenState/Loading/Toast), permission matrix (`roles-catalog.ts`/`permission-catalog.ts`), migrations (zero drift CI), accounting impact (cross-module scenarios), API contracts (`*.dto.ts` + class-validator + NestJS ValidationPipe), audit events (`domain-events.service.ts` + registry test), automated tests (per-module), posting+reversal (cross-module scenarios), report source-of-truth (`report-registry.ts` `sourceOfTruth`/`reconciliation` fields), background job retry/idempotency (GAP #37).

---

## F. Release/process gaps outside the roadmap

- [x] 41. **35 commits unmerged** — `chore/verification-closure` holds Phases 10-12 and is ahead
      of `main`.
      Current state: `chore/verification-closure` is **39 commits ahead, 0 behind** `main`
      (clean fast-forward). All 39 commits are verification/closure work on top of `main@35065e6`.
      Safe merge command: `git checkout main && git merge --ff-only chore/verification-closure`
      (or `git merge --no-ff` for a merge bubble). **Not performed** — merge decision is the
      repo owner's call.
- [x] 42. **`next start` vs `output: 'standalone'`** — production start command resolved.
      Changed `apps/web/package.json` `"start"` script from `next start` to
      `node .next/standalone/server.js`, which is the correct invocation for Next.js standalone
      output. The pre-existing warning logged in `docs/PHASE11_TODO.md` no longer applies.

---

## G. Documentation that contradicts captured evidence

- [x] 43. `docs/PHASE11_TODO.md:91-100` — 4 boxes unchecked above evidence ledger.
      All four boxes checked off in `docs/PHASE11_TODO.md` (E2E execution, gate run, visual review,
      roll-up) after confirming the evidence ledger records all four green on 2026-09-11.
- [x] 44. `docs/BUILD_ROADMAP.md:19-44` — stale snapshot.
      Already fixed: snapshot dated 2026-09-12, Phases 11–12 marked complete, test counts updated.
- [x] 45. `docs/EXECUTION_PLAN.md` — ~43 unchecked items under "complete and verified" headers.
      Audit found this claim inaccurate. All four "complete and verified" headers (Phases 9, 10, 11, 12)
      have every item either checked or correctly tracked as debt. The Phase 7 items are NOT under a
      "complete and verified" header. No drift exists — the GAPS entry itself was the stale item.
- [x] 46. `docs/PHASE1_TODO.md:376` — attachment content-type allowlist still shown open.
      Checked off in `docs/PHASE1_TODO.md`. Implementation confirmed in
      `apps/api/src/attachments/attachments.service.ts` (allowlist + forced download).

---

## Totals

**33 unchecked boxes remain.** Category labels above intentionally overlap where release tracks,
cross-module scenarios, and source-phase follow-ups refer to the same public-V1 work.

No unchecked item is currently flagged as a live correctness risk; the remaining items are unbuilt
scope, unproven scope, or paperwork.
