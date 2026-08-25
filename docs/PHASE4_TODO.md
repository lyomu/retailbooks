# RetailBooks Phase 4 (Accounting Engine) implementation checklist

Durable progress record for Phase 4 — the remainder of build spec §6 / blueprint §10 beyond what
Phase 1 Milestone 1G already shipped (chart of accounts, manual journals, the posting engine
`postJournalFromLines`/`finalizePosting`, trial balance, exact reversal, per-transaction FX via
`prepareFxPosting`). An item is checked only after its implementation has been verified.
`docs/BUILD_ROADMAP.md`'s Phase 4 section is the rolled-up summary; keep both in sync.

**All milestones (4A–4G) are implemented and verified as of this phase's closing commit.** Testing
was deferred to one end-of-phase pass per the recorded decision below; that pass ran to completion
(see 4G) with zero failures.

## Scoping decisions made up front (user-confirmed via plan mode, 2026-08-25)

1. **Posting-rule library scope = option (c): library + Phase 4's own postings + ONE pilot
   migration.** The declarative library was built and used for everything Phase 4 itself posts
   (opening balances, recurring journals, FX revaluation, rounding adjustments). The pilot migration
   moved `InvoicesService` onto it; the other six hand-rolling services (Bills, CreditNotes,
   VendorCredits, PaymentsReceived, PaymentsMade, Expenses) stay exactly as shipped — migrating
   them is explicitly deferred; revisit no earlier than after Banking/Inventory stabilize.
2. **Recurring Journal is built NOW** as a one-off template module mirroring the three existing
   recurring-template services and the shared `advanceCadence` helper in
   `apps/api/src/common/cadence.ts`. Phase 10's shared recurring engine remains the future
   consolidation point.
3. **Testing was deferred to one end-of-phase pass**, same as Phases 2–3 (explicit user choice).
   Money-invariant checks were still written alongside the posting logic they protect (roadmap
   non-negotiable).

## Facts established before design (so nothing gets duplicated)

- `LedgerService#postJournalFromLines` already provides operation-namespaced idempotency keys,
  external-tx participation, period-open enforcement, balance validation, journal number allocation,
  tax-snapshot freezing, audit events. The rule library sits ON TOP of it, not beside it.
- Per-transaction FX conversion (`prepareFxPosting`) converts a foreign-currency journal at its own
  date's rate and drops an fx_gain/fx_loss balancing line **per journal** — untouched by Phase 4.
  FX Revaluation is a **batch** restating existing monetary balances at the reporting rate,
  posting only the delta.
- `rounding` system account existed wired to nothing — now wired via the rounding policy (4E).
- `accounts.opening_balances.manage` was already reserved in `permission-catalog.ts` AND present in
  contracts' `permissionKeySchema`; it gained role wiring in 4B without any new key being added.

Sequencing rationale (as planned): 4A first because 4B–4E post through it; 4B highest user value;
4C small and independent; 4D most accounting-subtle; 4E small config + one posting hook; 4F pilot
deliberately AFTER 4B–4E hardened the library on real users; 4G wrap-up.

## Milestone 4A — Declarative posting-rule library ✅

- [x] New module `apps/api/src/posting-rules/`: a `PostingRule` describes one source event
      (`event` + `sourceType` + `version`) as an ordered list of line specifications derived from a
      typed source-document context; account references are by system key or resolved account id,
      never by code/name
- [x] Shared executor (`PostingRulesService#post`) validates every rule output before posting: >= 2 lines, single-sided lines, positive amounts, debits == credits, accounts active — then
      delegates to `LedgerService#postJournalFromLines` unchanged (same tx/idempotency/numbering/
      audit path); lives as an exported provider of `OrganizationsModule` to avoid a module cycle
- [x] Source-to-ledger traceability preserved: journal carries `sourceType`/`sourceId` plus a new
      nullable `journals.posting_rule` column holding the `event@vN` tag (migration
      `20260825221645_add_phase4_accounting_engine`)
- [x] Idempotency convention centralized: rule `event` doubles as the ledger idempotency operation
      namespace, caller-supplied keys per occurrence/batch, matching how InvoicesService used
      `'INVOICE_ISSUE'`
- [x] Rules registered declaratively next to their owning modules (opening-balances, recurring-
      journals, fx-revaluation, rounding inline; invoice pilot in `sales/invoice-posting-rule.ts`)
- [x] Contracts: none needed (internal library)
- [x] Test: money-invariant suite `apps/api/test/posting-rules.int.test.ts` — unbalanced rule
      output rejected before ANY row exists; unknown/inactive account fails closed; happy path
      posts balanced with full traceability; same-key atomic replay; external-tx rollback probe

Implementation notes (verification pass): the executor's validation runs BEFORE any draft exists,
so a buggy rule cannot leave partial state. The `externalTx` probe test proves a surrounding
operation's rollback takes the rule-posted journal down with it.

## Milestone 4B — Opening Balances wizard ✅

- [x] `OpeningBalanceBatch` (DRAFT/VALIDATED/FINALIZED/VOID; asOfDate) + `OpeningBalanceLine`
      (account-level debit/credit) + `OpeningBalancePartyLine` (RECEIVABLE→contact /
      PAYABLE→vendor, positive amount, server-derived `nameSnapshot`)
- [x] Party lines are the ONLY way to move AR/AP: a manual account line against either control
      account is rejected at validation; party detail therefore aggregates into its control account
      by construction (inventory opening is an ordinary account line against `inventory_asset`)
- [x] Validation gate requires every structural invariant plus total debits == total credits across
      the whole batch BEFORE finalize is possible; finalize re-runs the full gate inside its tx
- [x] Finalize posts once through the rule library (`OPENING_BALANCE_FINALIZE@v1`,
      sourceType 'OPENING_BALANCE'), idempotent per batch (key `BATCH:<id>`), reversible only as a
      whole via void-with-exact-reversal guarded against later activity on affected accounts
- [x] Permission `accounts.opening_balances.manage` wired into ADMIN/ACCOUNTANT +
      `READ_ONLY_BASELINE` exclusion; reads fold under `accounts.view`; no new key created
- [x] UI: `/opening-balances` wizard page (`opening-balances-workbench.tsx`) — batches list +
      editor with account-line grid, AR/AP party panels from live customer/vendor lists, live
      balanced/unbalanced indicator, validate/finalize/void actions
- [x] Test: `apps/api/test/opening-balances.int.test.ts` — balanced finalize posts correct lines;
      unbalanced cannot validate nor finalize; control-account manual line rejected; double-finalize
      idempotent; void reverses exactly while accounts are untouched and refuses after later activity

Implementation notes (verification pass): boundary-matrix entries added for all seven routes; the
eight-role sweep enforces the new permission end-to-end over HTTP.

## Milestone 4C — Recurring Journal ✅

- [x] `RecurringJournalTemplate` + `RecurringJournalTemplateLine` models (cadence reuses the
      existing `RecurringCadence` enum; startDate/endDate/nextRunDate/active/memo). A proposed
      `autoPost` flag was deliberately dropped before shipping — the roadmap requires only
      template+cadence+start/end+occurrence uniqueness, and generated journals always post through
      the rule library (migration `20260825231255_add_recurring_journal_templates` +
      `20260825231527_drop_recurring_journal_auto_post`)
- [x] `runDueTemplates()` mirrors the 3G `claimOccurrence` primitive with ONE deliberate divergence:
      the occurrence claim uses its own `'RECURRING_JOURNAL_CLAIM'` idempotency namespace, distinct
      from the rule posting's `'RECURRING_JOURNAL_GENERATE'` namespace — sharing one namespace made
      the executor mistake the claim row for its own completion record and abort
- [x] Generated entries unique per schedule occurrence (claim key `<templateId>:<date>`), posted
      through the rule library (`RECURRING_JOURNAL_GENERATE@v1`, sourceType 'RECURRING_JOURNAL');
      month-end clamping via shared `advanceCadence`; endDate deactivation when the NEXT occurrence
      would fall past the end
- [x] Permissions `journals.recurring.view`/`.manage` (group Journals) wired into ADMIN/ACCOUNTANT
      (+ view-only baseline); landed in all four places (catalog keys+entries, roles-catalog,
      contracts permissionKeySchema — group enum already carried 'Journals')
- [x] Contracts: none needed beyond permission keys; UI management screen `/recurring-journals`
      (list + create form with balanced line grid + run-due-now + deactivate/reactivate)
- [x] Test: `apps/api/test/recurring-journals.int.test.ts` — generation + cadence advance +
      endDate deactivation + skip-not-due + unbalanced-template rejection + concurrent double-trigger
      yielding exactly one journal, one claim, one posting record

## Milestone 4D — FX Revaluation batch ✅

- [x] `FxRevaluationRun` model (unique per organization+asOfDate; links the posted journal; records
      gain/loss totals) — migration `20260825233500_add_fx_revaluation_runs`
- [x] Batch identifies foreign-currency net monetary positions per (ASSET/LIABILITY account ×
      currency) from frozen `foreignAmountMinor` legs on posted journals, restates each at the
      effective reporting rate for the run date (`CurrencyService#resolveRate`), aggregates deltas
      per account, and posts ONE journal through the rule library (`FX_REVALUATION_RUN@v1`,
      sourceType 'FX_REVALUATION'): position legs + offsetting `fx_loss`/`fx_gain` legs
- [x] Occurrence idempotency: unique(org, date) + conflict rejection; distinctness from
      `prepareFxPosting` documented in the service header
- [x] Permission: reuse of `journals.post` for run / `journals.view` for list (no new key)
- [x] Test: `apps/api/test/fx-revaluation.int.test.ts` — known USD receivable booked @10 restated
      @9 yields exactly DR nothing / CR AR 10000 + DR fx_loss 10000; same-date rerun rejected;
      empty-position org rejected

Implementation notes (verification pass): direction semantics verified — negative delta (weakened
position) credits the monetary account and debits fx_loss; gains mirror. Zero-delta positions
produce no lines and no run.

## Milestone 4E — Rounding policy + dedicated rounding account ✅

- [x] `RoundingMode` enum (NONE default | HALF_UP) + `roundingUnitMinor` on OrganizationPreference;
      editable via the existing ACCOUNTING section of `PATCH /organizations/:id` with validation
      (unit >= 2 required for HALF_UP) — migration `20260825235233_add_rounding_policy`
- [x] Pure helper `computeCashRoundingDelta(amountMinor, unitMinor)` in `accounting-core` (unit <= 0
      disables; nearest-multiple semantics, half-up at exactly half)
- [x] `RoundingService#postAdjustment` posts the difference between a caller-named account and the
      seeded `rounding` system account through the rule library (`ROUNDING_ADJUSTMENT@v1`,
      sourceType 'ROUNDING'); mode NONE rejects adjustments, preserving today's behavior exactly
- [x] Test: `packages/accounting-core/src/rounding.test.ts` (pure semantics incl. negatives) +
      `apps/api/test/rounding.int.test.ts` (HALF_UP configured → balanced 2-line journal touching
      `rounding`; NONE → rejection with zero journals written)

Implementation notes (verification pass): this ships the policy + posting hook; wiring automatic
cash-rounding into future document flows is where Banking/Inventory consume it.

## Milestone 4F — Pilot migration: InvoicesService onto the library ✅

- [x] `InvoicesService#issueInvoice` now declares `INVOICE_ISSUE_RULE`
      (`apps/api/sales/invoice-posting-rule.ts`, event 'INVOICE_ISSUE', sourceType 'SALES_INVOICE',
      version 1) producing byte-identical journal output — same consolidated AR/revenue/tax lines,
      descriptions, sourceType/sourceId, and idempotency operation
- [x] Existing invoice integration tests passed UNMODIFIED (6/6), which is the regression contract;
      journals additionally gain `postingRule: 'INVOICE_ISSUE@v1'`
- [x] Explicitly out of scope (unchanged): Bills, CreditNotes, VendorCredits, PaymentsReceived,
      PaymentsMade, Expenses
- [x] Test: covered by the unmodified suite; rule identity asserted by the 4A suite's traceability
      pattern

## Milestone 4G — Canonical acceptance tests, sync, verification pass ✅

- [x] Canonical posting acceptance tests (build spec §6 table) confirmed pinned at exact Dr/Cr level:
  - Invoice issue → Dr AR / Cr Revenue + Tax Payable: `invoices.int.test.ts` (now posting THROUGH
    the rule library — same assertions, unmodified)
  - Customer payment → Dr Bank/Cash / Cr AR: `payments.int.test.ts`
  - Bill posting → Dr Expense/Inventory/Asset + Recoverable Tax / Cr AP: `bills.int.test.ts`
  - Vendor payment → Dr AP / Cr Bank/Cash: `payments-made.int.test.ts`
  - Credit note → Dr Revenue/Tax reversal / Cr AR/customer credit: `credit-notes.int.test.ts`
  - **BLOCKED — not faked:** Inventory cost on sale → Dr COGS / Cr Inventory Asset. No Inventory
    subsystem exists until Phase 6; flagged here and in the roadmap rollup.
- [x] Permission keys land in all four places for both new key pairs; catalog↔contracts drift check
      green (`permission-resolution.test.ts`)
- [x] Full verification pass: migrations accumulated into five phase-4 folders, applied to dev and
      test DBs, `prisma generate` clean; root `npm run typecheck` 0 errors; `npm run lint`
      (--max-warnings=0) clean; prettier write/check clean; **unit suites 74 (api) + 25
      (accounting-core) + 7 (localization) + 5 (ui) green; integration suite 238 tests across 32
      files green**, including the extended eight-role authorization-boundary matrix (~195 endpoints);
      drift check both directions exit 0; root `npm run build` succeeds (web build includes
      `/opening-balances` and `/recurring-journals`)

### Findings during the pass (process lessons, not product bugs)

- Rewriting an already-applied migration folder under the same name silently diverges every database
  that applied the old content (hit twice: dev DB and the harness's `retailbooks_test`). Recovery
  required marker surgery. Rule going forward: **schema changes after a folder has been applied get
  a NEW timestamped folder**, never an edit — followed for all later Phase 4 migrations.
- The bare-`DELETE FROM _prisma_migrations` recovery step wiped history markers and had to be
  restored via `prisma migrate resolve --applied` per folder — avoid by scoping deletes to the exact
  migration name.
- Sweep-style occurrence claims and posting-idempotency records must live in DIFFERENT
  `LedgerIdempotencyKey.operation` namespaces (documented in `recurring-journals.service.ts`).
