# RetailBooks Execution Plan — Verification Closure + Phases 7–9

**Created:** 2026-09-02 · **Scope:** close the verification debt on Phases 1, 5, and 6; fix the
three CI blockers; then deliver Phases 7 (Projects & Time), 8 (Globalization), and 9 (Reporting)
to the roadmap's own "done and verified" bar.

**Source of truth:** `docs/BUILD_ROADMAP.md` for scope, `docs/PHASE<N>_TODO.md` for milestone
records. This file is the sequencing plan across them; it does not replace either. When this file
and a `PHASE<N>_TODO.md` disagree after work lands, the TODO file wins.

---

## 0. Why this order

Three hard dependencies drive the sequence:

1. **CI is red on `main` today.** Every later stage's "verified" claim is unprovable until the
   pipeline is green, because the pipeline is what proves it. This goes first, and it is small.
2. **Phase 5 (Banking) has zero tests and Phase 6 (Inventory) was built on top of it.** COGS
   posting sits above untested cash/reconciliation code. This debt compounds with every phase
   added above it, so it is paid before new feature work — not after.
3. **`JournalLine` has no dimension columns.** Phase 7 profitability and Phase 9's
   dimension-filtered reports both require them. The column lands in Phase 7's migration or
   Phase 9 gets rewritten. See Decision D1.

Stages 0–3 are sequential. Stage 4 (Phase 1 debt) is parallelizable and partly deferrable.
Stages 5–7 are the roadmap's own order and must stay in it: Phase 9's Projects reports need
Phase 7's data, and Phase 9's report definitions need Phase 8's currency/locale semantics settled.

---

## Stage 0 — Unblock CI

**Goal:** `npm run lint`, `format:check`, `typecheck`, and `test` all green, so the pipeline can
adjudicate every later stage. **Size:** under an hour. **Blocks:** everything.

- [x] **0.1** Fix `no-irregular-whitespace` at `apps/api/src/banking/csv.ts:12` (col 33).
      **Resolved:** it was not stray whitespace — the parser strips a UTF-8 BOM and wrote the
      U+FEFF as a literal character inside the regex. Rewritten as `/^\uFEFF/`, so the
      behaviour is identical and the intent is now readable.
- [x] **0.2** Remove the unused `CheckCircle2` and `Send` imports at
      `apps/web/src/components/inventory-workbench.tsx:28`. Confirm they are not referenced in JSX
      before deleting — an unused-import error can mean a dropped button, not dead code.
- [x] **0.3** Run `npm run format` (22 files: banking, inventory, purchases, contracts,
      `docs/PHASE6_TODO.md`). Commit this separately from 0.1/0.2 so the formatting noise does not
      bury the two real fixes in review.
- [x] **0.4** Verify: `npm run lint && npm run format:check && npm run typecheck && npm test`.
      Expected: 0 lint errors, 0 format warnings, 7 workspaces typechecked, 112 unit tests passing.
- [x] **0.5** Commit as two commits (`fix:` then `style:`).

**Exit gate:** the four commands above pass locally. Migration drift, integration tests, and build
are _not_ checked here — they need Postgres and land in Stage 2.

---

## Stage 1 — Make the documentation true

**Goal:** a future session (or agent) reading `docs/` gets an accurate picture. Right now it does
not. **Size:** under an hour. **Depends on:** nothing; can run alongside Stage 0.

- [x] **1.1** `docs/BUILD_ROADMAP.md:19` — the status snapshot still reads _"Phases 5–14 have no
      code yet."_ Rewrite it to reflect Phases 5 and 6 shipped, with the current verification state
      of each stated explicitly (not implied).
- [x] **1.2** `docs/BUILD_ROADMAP.md:341–388` — the entire Phase 5 section is unchecked despite
      commit `ae8ae3e`. Check the 20 Data model / Backend / UI items that are genuinely built.
      **Leave the 5 Tests/acceptance items unchecked** — they are the real Stage 2 work.
- [x] **1.3** `docs/PHASE6_TODO.md` — un-check _"Extend the authorization-boundary matrix for all
      Phase 6 controllers."_ It is marked done and is not done; the `CONTROLLERS` array at
      `apps/api/test/authorization-boundary.int.test.ts:1101` ends at `FxRevaluationController`.
      A checkbox that lies is worse than one that is honestly open.
- [x] **1.4** Rewrite `docs/HANDOVER.md`. It currently describes Phase 5 as in-progress with three
      screens unbuilt; all six exist and Phase 6 has shipped since. Keep §2 (environment quirks)
      and §3 (conventions) — both are still accurate and hard-won.
- [x] **1.5** Add a line to §3 conventions: _roll the roadmap section up at close-out, in the same
      commit as the phase._ Phase 5 drifted precisely because that step was optional.

**Exit gate:** `BUILD_ROADMAP.md`, `PHASE5_TODO.md`, `PHASE6_TODO.md`, and `HANDOVER.md` agree with
`git log` and with the code.

---

## Stage 2 — Phase 5 verification pass (Banking & Reconciliation)

**Goal:** close the 7 deferred items in `docs/PHASE5_TODO.md` and the 5 Tests/acceptance items in
the roadmap. **Size:** the largest single chunk of remediation — budget 2–3 focused sessions.
**Depends on:** Stage 0. **This is the highest-risk open item in the repo.**

**Prerequisite:** `npm run infra:up`. The RetailBooks Postgres/Redis containers are not currently
running (other projects' containers are, which is easy to misread as "the DB is up").

### 2A — `apps/api/test/banking.int.test.ts`

Model it on `apps/api/test/inventory.int.test.ts`: boot `createTestHarness()`, pull services off
`harness.app.get(...)`, drive real service calls against `retailbooks_test`. Six groups:

- [x] **2A.1 Duplicate-fingerprint detection.** Import a CSV, re-import the same file, assert the
      second import records duplicates rather than creating second `BankTransaction` rows. Cover
      the near-miss too: same date/amount, different description → _not_ a duplicate. Exercise
      `bank-transaction-fingerprint.ts` directly for the hash, and through the service for the
      dedupe decision.
- [x] **2A.2 Match cannot double-allocate.** Match a bank transaction to a payment, then attempt a
      second match against the same source from a different transaction; assert rejection. Then
      unmatch and re-match to prove the guard releases correctly. This is the invariant most likely
      to be silently wrong.
- [x] **2A.3 Categorize and split posting.** Assert a categorized transaction posts a balanced
      journal through `PostingRulesService`, that a split posts one journal whose lines sum to the
      transaction amount, and that exclude-with-reason posts nothing at all.
- [x] **2A.4 Transfers.** Same-currency transfer posts a balanced journal touching both financial
      accounts' GL mappings. Cross-currency transfer posts the FX leg to `fx_gain`/`fx_loss` and
      still balances in base currency. Void reverses exactly — assert the reversal is a new journal,
      not an edit.
- [x] **2A.5 Reconciliation lock.** Completion at non-zero difference is rejected; at exactly zero
      it succeeds and locks; a locked reconciliation rejects clear/unclear; reopen requires a reason
      and writes an audit event.
- [x] **2A.6 Money invariants.** Every posting assertion above also asserts
      `sum(debitMinor) === sum(creditMinor)`, per the roadmap's non-negotiables.

### 2B — Close the authorization-boundary gap (and stop it recurring)

- [x] **2B.1** Add the 6 banking controllers (`FinancialAccounts`, `BankRules`, `StatementImports`,
      `BankTransactions`, `Transfers`, `Reconciliations`) and `InventoryController` to `CONTROLLERS`
      in `authorization-boundary.int.test.ts`, then add the ~43 corresponding `ENDPOINTS` entries
      (29 banking + 14 inventory) with their permission keys.
- [x] **2B.2 Fix the blind spot that let this happen.** The existing _"keeps the declared matrix
      synchronized"_ test compares `ENDPOINTS` against `discoverOrganizationEndpoints(CONTROLLERS)`
      — both hand-maintained, so omitting a controller from _both_ is invisible. Replace the
      hardcoded array with a walk of the booted Nest module graph (`harness.app` already has the
      container), filtering to controllers guarded by `OrganizationGuard`. Then a new Phase 7/8/9
      controller fails this test on the day it is written instead of shipping uncovered.
- [x] **2B.3** Re-check the sweep timeout. It is 180s for ~195 endpoints × 8 roles; adding ~43
      endpoints is a ~22% increase. Raise to 240s rather than discovering the flake in CI.

### 2C — Full gate

- [x] **2C.1** `npm run test:integration` — expect 34 files green.
- [x] **2C.2** Migration drift check, both directions, per the CI command.
- [x] **2C.3** `npm run build` (API + web production builds).
- [x] **2C.4** Check off the 7 deferred items in `PHASE5_TODO.md` and the 5 roadmap
      Tests/acceptance items. Phase 5 is now genuinely done.

**Exit gate:** the full CI command sequence passes locally, end to end.

---

## Stage 3 — Phase 6 closure

**Size:** minutes, given Stages 0 and 2. **Depends on:** Stage 2.

- [x] **3.1** The single open item in `PHASE6_TODO.md` is _"Run lint, prettier, migration drift, and
      build checks when requested"_ — satisfied by 0.4 and 2C. Check it off.
- [x] **3.2** Re-check 1.3's boundary-matrix item, now that 2B.1 makes it true.
- [x] **3.3** Confirm the roadmap's Phase 14 cross-module scenario 2 (retail) can be checked — it is
      covered by `inventory.int.test.ts` but left unchecked in the Phase 14 list. Check it there
      too; it is the only one of the 8 currently earned.

---

## Stage 4 — Phase 1 hardening debt (8 items)

**Recommendation: split it.** Four items are cheap now and protect every later phase. Four are
genuinely release-gate work that will be redone at Phase 14 anyway, and doing them now means doing
them twice — Phases 7–9 add ~20 screens and a report engine.

### Close now (protects Phases 7–9)

- [ ] **4.1 Performance budgets and query/index review.** Do this _before_ Phase 9, not after.
      `LedgerService.trialBalance` (`ledger.service.ts:684`) loads every posted `JournalLine` into
      memory and reduces in JS. That is survivable for a trial balance on a demo org and fatal as
      the foundation of nine report families. Establish the SQL-aggregation pattern here, then
      Phase 9 inherits it. See Decision D2.
- [ ] **4.2 Audit-log coverage and immutable-posting invariant verification.** Assert every
      money-moving Phase 5/6 action writes an audit event, and that no posted journal is ever
      updated in place. Cheap to add alongside Stage 2's tests, expensive to retrofit across 14
      phases.
- [ ] **4.3 Update `DESIGN.md` from the implemented system.** It predates ~50 screens. Phases 7–9
      add ~20 more against it as reference; stale reference means drift compounding.
- [ ] **4.4 Threat model and secret-handling review.** Scoped review now that banking (statement
      upload, CSV parsing, file storage) exists. CSV import is untrusted-input parsing — it deserves
      a look before more import paths land in Phases 8 and 9.

### Fold into Phase 14 (do once, at the end)

- [ ] **4.5** Capture visual-regression baselines (currently 2 screenshots per breakpoint, so this
      is effectively unstarted) — defer until the screen inventory stops growing.
- [ ] **4.6** Visual regression at desktop/tablet/mobile — same reason.
- [ ] **4.7** WCAG 2.2 AA keyboard/screen-reader/contrast/focus review — do once, across the full
      surface, rather than three times.
- [ ] **4.8** Backup/restore drill and operational runbooks — no new-feature dependency.

Record this split in `PHASE1_TODO.md` so the deferral is a decision on the record rather than a
gap someone rediscovers.

---

## Decisions to make before Stage 5

These three change the shape of the work. Decide them explicitly and write them at the top of the
relevant `PHASE<N>_TODO.md`, the way Phase 4's three scoping decisions were recorded.

**All three were decided on 2026-09-02.** Each option list below is kept so the reasoning that was
rejected stays visible; the **Resolved** line under each is what binds. Carry the resolution into
`PHASE7_TODO.md` / `PHASE8_TODO.md` / `PHASE9_TODO.md` when each file is created at its stage.

### D1 — Ledger dimensions (blocks Phase 7 and Phase 9)

`JournalLine` has **no** dimension columns. `InvoiceLine.projectTag` is a free-text `VarChar(80)`,
not a relation. Phase 7 needs project profitability (revenue and cost by project); Phase 9 needs
"dimensions/tags" as a first-class report filter. Options:

- **(a) Add `projectId` + `tagId` to `JournalLine` in Phase 7's migration** — recommended.
  Dimension-aware reporting becomes a `groupBy`, profitability reads from the ledger, and the
  numbers reconcile to the GL by construction rather than by a parallel aggregation.
- **(b) Keep dimensions on documents only, aggregate at report time** — cheaper migration, but
  profitability and the P&L can disagree, which is exactly the class of bug an accounting product
  cannot ship.
- **(c) Generic `dimension` join table** — most flexible, most expensive, and unnecessary if
  project and tag are the only two dimensions V1 needs.

Whichever is chosen, posted lines must freeze their dimension the way tax snapshots already do.

**Resolved (2026-09-02): (a).** `JournalLine` gains nullable `projectId` and `tagId` in Phase 7's
migration. Existing rows are not backfilled — historical journals predate projects, and a
nullable column states that honestly. `LedgerService.postJournal` freezes the dimension inside the
posting transaction at the same point it freezes the tax snapshot, so a later re-tag of a document
can never drift an already-posted line. Profitability and Phase 9's dimension filters then read
from the ledger, and reconcile to the P&L by construction rather than by a parallel aggregation
that can disagree. Rejected (b) for exactly that disagreement risk, and (c) because a generic
dimension join table buys flexibility V1 has no second use for.

### D2 — Report engine query strategy (blocks Phase 9)

Follow the `trialBalance` in-memory pattern, or move to SQL aggregation (`groupBy` / raw CTEs) with
the in-memory version refactored to match? **Recommend SQL aggregation**, decided at 4.1 and applied
uniformly. Nine report families over an append-only ledger is exactly the workload that punishes
in-memory reduction, and retrofitting after ~30 reports exist is a rewrite.

**Resolved (2026-09-02): SQL aggregation.** The rule and its budgets are written down in
`docs/PERFORMANCE.md`, and Stage 4.1 converts the four ledger read paths that reduced in JS
(`trialBalance`, `listAccounts`, `accountLedger`'s opening balance, `accountBalance`) onto it.
`trialBalance` is the reference implementation Phase 9's engine copies.

### D3 — Country packs: static catalog → DB model (shapes Phase 8)

`jurisdiction-catalog.ts` is 484 lines of frozen static reference data with two packs (Kenya
demonstration, generic fallback). Phase 8 wants a versionable, publishable `CountryPack` entity, and
Phase 12's admin console is built on it. Recommend: introduce the DB model in Phase 8, seed it from
the static catalog, keep the static file as the seed source and fallback, and cut readers over to
the DB. Do **not** delete the static catalog — it is the bootstrap path for a fresh database.

**Resolved (2026-09-02): as recommended.** `CountryPack` becomes a versioned DB entity in Phase 8,
seeded from `jurisdiction-catalog.ts`; readers move to the DB; the static file stays as both the
seed source and the fresh-database fallback. The Kenya pack keeps its explicit _demonstration_
labelling through the migration — the model must not launder an unreviewed pack into an implied
compliance claim.

---

## Stage 5 — Phase 7: Projects & Time

**Roadmap:** `BUILD_ROADMAP.md:435–481`, 24 items. **Entities:** `Project`, `ProjectTask`,
`TimeEntry`, `ProjectExpense`, `ProjectBudget`. **Depends on:** D1, Stages 0–3.
**Size:** comparable to Phase 3 (Purchases) — the largest of the three new phases, because it
introduces a new document→invoice path and the first approval workflow outside accounting.

### 7A — Schema and migration

- [ ] `Project` (customer, name, dates, billing method, budget, status, manager)
- [ ] `ProjectTask` (project, name, assignee, estimate, billable default)
- [ ] `TimeEntry` (date, project/task, user, hours, billable, rate, note)
- [ ] `ProjectExpense` (linked `Expense`, billable markup/rate, invoiced-once guard column)
- [ ] `ProjectBudget`
- [ ] **Per D1:** dimension columns on `JournalLine` (+ backfill strategy for existing rows —
      nullable, no backfill; historical journals predate projects)
- [ ] Replace or complement `InvoiceLine.projectTag` free text with a real `projectId` relation;
      decide whether the old column is migrated or retired
- [ ] Migration via the documented shadow-db `migrate diff` dance (`HANDOVER.md` §2 — `prisma
migrate dev` hard-fails non-interactively; never edit an applied migration folder)

### 7B — Backend

- [ ] Projects: lifecycle Open → On Hold → Completed → Cancelled
- [ ] Tasks: inherit project-level access
- [ ] Timesheets: **submitted time is immutable until rejected/unlocked** — same immutability
      discipline as posted journals
- [ ] Time approval: by period/user/project, approve/reject with comment
- [ ] Project expenses: **cannot invoice the same expense twice** (enforce in the DB with a unique
      constraint on the invoiced link, not only in the service — this is a money invariant)
- [ ] Generate Invoice from approved unbilled time/expenses → creates `InvoiceLine`s with source
      links, posting through the existing `sales/invoice-posting-rule.ts`. Reuse; do not fork the
      invoice posting path.
- [ ] Profitability: revenue, billed/unbilled time, cost, expenses, margin, drill-down to source
- [ ] Idempotency key on the generate-invoice endpoint (roadmap non-negotiable, currently open)

### 7C — Permissions and contracts

- [ ] `projects.*` permission keys — remember all **four** places: catalog keys array, catalog
      entries, `roles-catalog.ts`, contracts `permissionKeySchema` + group enum
- [ ] Wire `PROJECT_MANAGER`'s real permission set — today it is a placeholder holding only
      `['organization.view']` (`roles-catalog.ts:407`)
- [ ] Contracts: Zod schemas, DTOs, response wrappers, inferred types for all five entities

### 7D — Web workspace

- [ ] Projects list / create-edit / detail
- [ ] Tasks within project detail
- [ ] Timesheet entry (timer + manual)
- [ ] Time approval screen
- [ ] Project expenses screen
- [ ] Generate-invoice-from-billables flow
- [ ] Profitability report/dashboard
- [ ] `Projects` nav group in `app-shell.tsx` (mirror the Banking/Inventory group shape; items
      unconditional, pages self-gate via `ForbiddenState`)

### 7E — Tests (not deferred this time)

- [ ] Approved billable time becomes invoiceable exactly once
- [ ] A project expense cannot be invoiced twice
- [ ] Cross-module scenario 3 (build spec §18.3): project → approved time + expense → generate
      invoice → record payment → profitability and ledger reconcile
- [ ] Timesheet immutability after submit
- [ ] Boundary matrix picks up the new controllers **automatically** via 2B.2 — if it does not,
      2B.2 is not finished
- [ ] Check off Phase 14 cross-module scenario 3

### 7F — Close-out

- [ ] `docs/PHASE7_TODO.md` created and fully checked, roadmap section rolled up **in the same
      commit**, `HANDOVER.md` refreshed

---

## Stage 6 — Phase 8: Globalization

**Roadmap:** `BUILD_ROADMAP.md:481–521`, 14 items. **Depends on:** D3.
**Size:** the smallest of the three, but it carries the most legal risk — the compliance-claim
rules are not cosmetic.

### 8A — Schema and migration

- [ ] `CountryPack` as a versioned entity (version, status, supported entity types, defaults)
- [ ] `TaxPack` tied to country pack (labels, rates, registration fields, inclusive/exclusive
      rules, exemptions, reporting mappings)
- [ ] `DocumentRule` per country (required legal fields, numbering constraints, labels, footer text)
- [ ] `StructuredInvoice` — canonical JSON/XML-ready model, **stored separately from the PDF
      snapshot** (`DocumentSnapshot` stays the render artifact; this is the data artifact)
- [ ] Seed from `jurisdiction-catalog.ts` per D3

### 8B — Backend

- [ ] Country-pack CRUD + version/publish/deprecate (Phase 12's admin console consumes this)
- [ ] Tier A/B/C launch-country packs: fully reviewed / generic without compliance claim / blocked
      from compliance-sensitive setup
- [ ] Per-organization compliance-status flag — **never imply compliance where unreviewed.** The
      existing Kenya pack is explicitly a _demonstration_ pack; keep that honesty in the model.
- [ ] Locale/i18n string catalog (organizations have a `locale` field today with no catalog behind
      it)
- [ ] **Finalized transactions retain the pack version active when issued** — extend the existing
      tax-snapshot pattern rather than inventing a second freezing mechanism

### 8C — UI

- [ ] Compliance-status badge in organization settings
- [ ] Locale/language switcher (only once a catalog exists behind it)

### 8D — Tests

- [ ] Structured invoice round-trips and stays independent of PDF rendering
- [ ] Unsupported-jurisdiction compliance claims never render
- [ ] A pack version pinned to a transaction does not change when the pack is later edited

### 8E — Close-out

- [ ] `docs/PHASE8_TODO.md`, roadmap roll-up, handover refresh — same commit

---

## Stage 7 — Phase 9: Reporting

**Roadmap:** `BUILD_ROADMAP.md:522–560`, 16 items — but item count badly understates it: the
"Reports to implement" bullets expand to roughly 30 individual reports across 9 families.
**Depends on:** D1, D2, Stage 5 (Projects reports), Stage 6 (currency/locale semantics), 4.1.
**Size:** the largest phase in this plan. Sequence it engine-first, reports in batches.

### 9A — Report engine core

- [ ] Report-definition registry: each report declares its source-of-truth query, columns, and
      totals in one place (this is what makes the reconciliation tests in 9F writable at all)
- [ ] Date/basis handling — cash vs accrual **only where the accounting logic genuinely supports
      it**; the roadmap says so explicitly, so surface "accrual only" rather than faking cash basis
- [ ] Currency: transaction currency vs base currency, per D2's aggregation approach
- [ ] Dimensions/tags filtering (needs D1)
- [ ] Comparison periods
- [ ] Drill-down to source transactions — every figure must be traceable, which Phase 13's
      "explain a number" later depends on
- [ ] Built on SQL aggregation per D2, with `trialBalance` refactored onto the same path as the
      reference implementation

### 9B — Export architecture

- [ ] CSV, XLSX, PDF. Reuse `sales/document-rendering.service.ts` (Playwright) for PDF rather than
      adding a second renderer
- [ ] Large-report path: stream or queue rather than building in request memory

### 9C — Reports, in dependency batches

- [ ] **Batch 1 — Financial:** P&L, Balance Sheet, Cash Flow, Trial Balance (exists — port to the
      engine), General Ledger, Journal Report
- [ ] **Batch 2 — Receivables/Payables:** AR & AP Aging Summary/Detail, Customer/Vendor Balances,
      Invoice & Bill Details, Payments Received/Made
- [ ] **Batch 3 — Sales/Purchases:** by customer, item, period, salesperson/tag; by vendor,
      category, period
- [ ] **Batch 4 — Tax:** Tax Summary, Tax Detail, taxable/exempt bases, liability/recoverable
- [ ] **Batch 5 — Inventory:** Stock on Hand, Valuation, Movements, Adjustments, Reorder (several
      have Phase 6 endpoints already — port, do not duplicate)
- [ ] **Batch 6 — Projects:** Time, Unbilled Time/Expenses, Revenue/Cost, Profitability (Phase 7's
      profitability view ports here)
- [ ] **Batch 7 — Audit:** transaction history, user activity, approvals, void/reversal history

### 9D — Saved and scheduled reports

- [ ] Saved filters / saved reports — deliver in Phase 9
- [ ] **Scheduled delivery: defer to Phase 10.** The roadmap itself routes it through Automation,
      and there is no generalized `ScheduledJob` yet (only the email queue). Building a second
      scheduler here guarantees consolidating two later. Record the deferral in `PHASE9_TODO.md`.

### 9E — UI

- [ ] Report Library / Saved Reports navigation section
- [ ] One shared report shell — filters, comparison, drill-down, export — used by all ~30 reports.
      Build it once, before Batch 1, or it will be rebuilt seven times.

### 9F — Tests

- [ ] **Every report has a source-of-truth definition and a reconciliation test.** Non-negotiable:
      P&L and Balance Sheet tie to trial balance; AR/AP aging tie to their control accounts;
      inventory valuation ties to the inventory control account
- [ ] Base-currency statements reconcile against underlying transaction-currency postings
- [ ] Boundary matrix picks up report controllers automatically (2B.2)

### 9G — Close-out

- [ ] `docs/PHASE9_TODO.md`, roadmap roll-up, handover refresh — same commit

---

## Definition of done (every stage above)

From the roadmap's own DoD, reduced to what is actually enforceable per phase:

1. Migration applied with **zero drift in both directions**
2. Permission keys in all four places; role sets wired, not placeholders
3. Contracts (Zod) complete for every endpoint
4. Audit events emitted for every state change
5. Posting **and reversal** tested for every accounting-impacting transaction
6. Every report has a reconciliation test (Phase 9)
7. Boundary matrix covers every new controller — automatically, per 2B.2
8. Full CI sequence green: format, lint, typecheck, drift, test, integration, build
9. `PHASE<N>_TODO.md` complete, roadmap section rolled up **in the same commit**, `HANDOVER.md`
   refreshed

---

## Risk register

| #   | Risk                                                                                   | Impact                                                                              | Mitigation                                                          |
| --- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| R1  | Phase 5 banking is untested money-movement code, and Phase 6 COGS sits on top of it    | A reconciliation or match bug corrupts the GL silently                              | Stage 2, before any new feature work                                |
| R2  | Boundary-matrix drift is systemic — the guard test cannot detect an omitted controller | Every future phase ships uncovered endpoints, as 5 and 6 did                        | 2B.2: derive controllers from the module graph                      |
| R3  | No domain event bus exists                                                             | Phase 10 Automation cannot subscribe; Phase 9 scheduled reports have nothing to use | Decide during Phase 9; it is a Phase 10 blocker, not a 9 blocker    |
| R4  | `trialBalance` reduces all journal lines in memory                                     | Phase 9 inherits the pattern across ~30 reports                                     | 4.1 + D2, before Phase 9 starts                                     |
| R5  | `prisma migrate dev` fails non-interactively; applied migrations must never be edited  | Phase 4 hit this twice and needed `_prisma_migrations` surgery                      | Follow `HANDOVER.md` §2 exactly; new folder, never an edit          |
| R6  | "Code first, tests later" produced Phase 5's debt                                      | Repeating it across Phases 7–9 compounds three phases of debt                       | Tests are inside each phase's milestones here, not a trailing stage |
| R7  | Phase 9 item count (16) understates ~30 reports                                        | Schedule slips late, when it is most expensive                                      | Batched in 9C; engine and shared UI shell first                     |
| R8  | D1 deferred or decided as option (b)                                                   | Profitability and P&L can disagree; Phase 9 partly rewritten                        | Decide D1 before Phase 7's migration is written                     |

---

## Sequencing summary

```
Stage 0 (CI) ──┬── Stage 1 (docs)
               │
               └── Stage 2 (Phase 5 tests + boundary fix) ── Stage 3 (Phase 6 close)
                                                                    │
                        Stage 4.1–4.4 (Phase 1 debt, parallel) ─────┤
                                                                    │
                                            D1, D2, D3 decided ─────┤
                                                                    │
                                    Stage 5 (Phase 7) ── Stage 6 (Phase 8) ── Stage 7 (Phase 9)
                                                                                      │
                                                    Stage 4.5–4.8 folded into ── Phase 14
```

Stages 0–3 are remediation and should complete before Stage 5 opens. Stages 5–7 follow the
roadmap's recommended build order and each closes to the Definition of Done above — no phase is
marked complete on code alone.
