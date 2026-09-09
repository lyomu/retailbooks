# RetailBooks — Master Build Roadmap (14 Phases)

Source of truth for scope: `starter/global_accounting_platform_build_specification_v1.docx` and
`starter/global_accounting_platform_master_blueprint.docx`. This document translates both specs into
one flat, checkable task list spanning all 14 pre-release phases, so every phase — not just Phase 1 —
has a concrete implementation and test checklist.

**How to use this file:** check an item off (`- [ ]` → `- [x]`) only when it is actually implemented
and verified (tests passing, not just code written). Add a one-line note under a milestone when useful,
following the style already used in `docs/PHASE1_TODO.md`.

**Relationship to `docs/PHASE1_TODO.md`:** that file remains the detailed, authoritative
milestone-by-milestone record for Phase 1 (it has implementation notes, ADR links, and test counts this
file does not duplicate). The Phase 1 section below is a rolled-up summary of it — keep both in sync
when Phase 1 hardening items close. Phases 2–14 exist only here; consider creating a
`docs/PHASE<N>_TODO.md` in the same style once a phase starts, and rolling its detail back into this
file the way Phase 1's is summarized.

**Status snapshot (2026-09-05):** Ten of fourteen phases have code, and nine of those meet this
document's "done and verified" bar apart from Phase 1's hardening debt and Phase 10's tracked debt
(named in its section below). Sequencing for everything below lives in `docs/EXECUTION_PLAN.md`.
Whole-repo gate at this snapshot: lint, prettier, and typecheck clean; 117 unit tests; **48
integration files / 335 tests**; migration drift zero in both directions plus migration replay from
scratch into a shadow database; API and web production builds green.

- **Phase 1 (Foundation)** — functionally complete, hardening/test debt open (Milestone 1J).
- **Phase 2 (Sales)** — complete and verified (2A–2K); see `docs/PHASE2_TODO.md`.
- **Phase 3 (Purchases)** — complete and verified (3A–3H); see `docs/PHASE3_TODO.md`.
- **Phase 4 (Accounting Engine remainder)** — complete and verified (4A–4G); see
  `docs/PHASE4_TODO.md`.
- **Phase 5 (Banking & Reconciliation)** — complete and verified (5A–5E). Shipped in `ae8ae3e`
  under a code-first rule with no tests; the verification pass closed on 2026-09-02 with
  `apps/api/test/banking.int.test.ts` (16 tests). One item stays open: the §18.1 end-to-end
  scenario, tracked as Phase 14 scenario 1.
- **Phase 6 (Inventory)** — complete and verified (6A–6E); see `docs/PHASE6_TODO.md`.
- **Phase 7 (Projects & Time)** — complete and verified (7A–7F); see `docs/PHASE7_TODO.md`. Carries
  decision D1's ledger dimensions, which Phase 9's dimension-filtered reports build on. Phase 14
  cross-module scenario 3 is earned here.
- **Phase 8 (Globalization)** — complete and verified (8A–8E); see `docs/PHASE8_TODO.md`.
- **Phase 9 (Reporting)** — complete and verified (9A–9F); see `docs/PHASE9_TODO.md`.
- **Phase 10 (Automation & Approvals)** — complete and verified (10A–10I) with tracked debt; see
  `docs/PHASE10_TODO.md`.
- **Phases 11–14** — **no code yet**: no models, modules, routes, or pages exist for portals,
  platform admin, or AI.

Two defects that the Phase 5/6 code-first rule had hidden were found and fixed during that pass:
the authorization-boundary matrix could not detect an omitted controller (43 endpoints were
uncovered), and three index names exceeded PostgreSQL's 63-byte limit, so migration drift was
non-zero in both directions.

Phase 7 ran under the same code-first rule and its test pass found one more: project profitability
reported cost as zero and margin as equal to revenue on every project, because nothing dimensioned
the expense side of the ledger. Three phases, three defects that only a test pass surfaced — the
pattern is worth weighing before granting a fourth phase the same rule.

---

## Legend

- `[x]` done and verified — `[ ]` not started or incomplete
- Each phase lists: **Data model**, **Backend/API**, **UI**, **Business rules & states**, **Tests/acceptance**
- Every phase inherits the [Platform-wide contracts](#platform-wide-contracts--non-negotiables) and the
  [shared screen patterns](#shared-screen-patterns) below — don't re-derive them per phase.

## Testing strategy: build first, verify in a follow-up pass

Within a phase, implement **Data model → Backend/API → UI → Business rules** before working through that
phase's **Tests/acceptance** section — don't block feature work on writing the full test list first. This
continues the pattern Phase 1 already used: every 1C–1I milestone note says tests were "intentionally
deferred to the agreed verification pass," followed by a dedicated verification pass (see
`docs/PHASE1_VERIFICATION_PLAN.md` and the Stage 0–1 entries in `PHASE1_TODO.md`) that caught the suite up
afterward. Do the same per phase here: build the vertical slice, then run a verification pass before
declaring the phase done.

Two things don't get deferred even under this approach, because they're cheap now and expensive to
discover late in an accounting product:

- **Money-invariant checks as you build them**, not after: posting always balances, reversal is exact,
  payment/credit allocation can never over-apply, stock can never go negative without a traceable
  movement. Write these as you implement the posting logic itself, not as a follow-up task.
- **A phase's own `Tests/acceptance` checklist must be fully checked off before that phase is marked done
  or a later phase that depends on it starts** — e.g. don't start Phase 6 Inventory's COGS posting on top
  of unverified Phase 2 invoice posting. Deferred means "after the feature work in this phase," not
  "indefinitely" or "someone else's problem later."
- Everything else — full integration suites, accessibility, visual regression, concurrency/load testing —
  can genuinely wait for the verification pass, same as Phase 1.

---

## Platform-wide contracts & non-negotiables

Established once, must hold for every module added in every later phase (build spec §1, §19; blueprint §8, §10).

- [x] Every tenant-owned row carries `organization_id`; tenant scoping enforced in service + guard layer
- [x] Database transactions wrap posting workflows (ledger posting/reversal today)
- [x] Money stored as fixed-precision integers (`BigInt` minor units), never floating point
- [x] Immutable posted journal lines; corrections via explicit reversal, not edits
- [x] UTC timestamps with transaction-local date/time-zone preserved where legally relevant
- [x] Versioned tax/config references frozen onto posted ledger lines (tax snapshot on `JournalLine`)
- [x] Idempotency keys on ledger post/reverse (`LedgerIdempotencyKey`)
- [ ] Idempotency keys extended to every future posting endpoint (invoice issue, bill posting, payment
      recording, stock movement) and to imports/recurring job runs
- [ ] Optimistic concurrency/version fields on high-risk financial records beyond the ledger (verify
      current models; add `version`/`updatedAt`-guard pattern to Sales/Purchases documents as they ship)
- [ ] Domain event emission (`invoice.issued`, `invoice.voided`, `payment.recorded`, `bill.posted`,
      `journal.posted`, `stock.moved`, `reconciliation.completed`) — no event bus exists yet; needed
      before Automation (Phase 10) can subscribe to business events
- [ ] Background consumers retry-safe and idempotent for every future queue (email queue already is;
      pattern must be reused for PDF, import, and recurring-job queues)
- [ ] PDFs generated from immutable snapshots of issued documents (no document/PDF pipeline exists yet
      — first needed in Phase 2)
- [ ] Public API/webhook contracts — explicitly deferred until internal contracts stabilize (not a V1 blocker per spec §19)

## Shared screen patterns

Applies to every List/Create-Edit/Detail/Import/Approval/Report screen built in Phases 2–13 (build spec §2).

- [ ] **List**: title, quick-create, search, saved filters/views, status/date/customer filters, sortable
      columns, bulk actions, pagination, export, column settings
- [ ] **Create/Edit**: header, required-field markers, autosave/draft policy, validation summary,
      contextual help, Save Draft, Submit/Approve/Issue actions as applicable
- [ ] **Detail**: status header, primary actions, totals, source/related docs, attachments, comments,
      accounting impact, audit timeline
- [ ] **Import**: upload → map columns → validate → preview → import → result/error file
- [ ] **Approval**: submitter, amount/context, approval chain, comments, approve/reject/resubmit, history
- [ ] **Report**: date/basis filters, currency, dimensions/tags, comparison, drill-down, export,
      save/schedule

Every critical screen must define loading, empty, error, no-permission, archived/void, and success
states (build spec §1) — the `ui` package already ships `EmptyState`/`ForbiddenState`/`Loading`/`Toast`
primitives from Phase 1; reuse them rather than rebuilding per module.

---

## Phase 1 — Foundation ✅ (functionally complete; hardening open)

Full detail lives in `docs/PHASE1_TODO.md` (Milestones 1A–1J). Delivered: design system, auth/sessions,
multi-tenant orgs + onboarding, 8-role RBAC with 47 permissions, localization/country-pack catalog,
fiscal years/periods with close/lock, configurable document numbering, full double-entry ledger with FX
posting and reversal, tax engine with inclusive/exclusive calc and snapshots, audit log, and matching
web UI for all of it. 22 Prisma models, 10 migrations applied and drift-checked in CI, 74 DB-free tests.

### Outstanding hardening/test debt (rolled up from `PHASE1_TODO.md`; close there first, then here)

- [ ] Capture initial visual-regression baselines against RetailFlow references (Milestone 1B)
- [x] Identity unit/integration tests incl. token expiry and replay cases (Milestone 1C) — proven by
      `identity-tenancy.int.test.ts`
- [x] Tenant-isolation integration tests (Milestone 1D) — proven by `identity-tenancy.int.test.ts` and
      `authorization-boundary.int.test.ts`
- [x] Boundary, concurrency, and time-zone tests for fiscal periods/numbering (Milestone 1F) — proven by
      `fiscal-periods-calendar.test.ts` and `accounting-invariants.int.test.ts`
- [x] Accounting invariant, idempotency, concurrency, and reversal tests for the ledger (Milestone 1G) —
      proven by `accounting-invariants.int.test.ts`
- [x] End-to-end journeys: identity, onboarding, teams, periods, journals, tax (Milestone 1J) — proven by
      `apps/web/e2e/phase1-journeys.spec.ts`
- [x] Cross-tenant and permission-boundary security tests (Milestone 1J) — proven by
      `authorization-boundary.int.test.ts`
- [ ] Visual regression at desktop/tablet/mobile breakpoints (Milestone 1J)
- [ ] WCAG 2.2 AA keyboard, screen-reader, contrast, and focus review (Milestone 1J)
- [ ] Performance budgets and query/index review (Milestone 1J)
- [ ] Audit-log coverage and immutable-posting invariant verification (Milestone 1J)
- [ ] Backup/restore drill and operational runbooks (Milestone 1J)
- [ ] Threat model, dependency review, secret-handling and production-readiness checklist (Milestone 1J)
- [ ] Update `DESIGN.md` from the implemented system (Milestone 1J)

---

## Phase 2 — Sales ✅

Full milestone-by-milestone detail (2A–2K) lives in `docs/PHASE2_TODO.md`, mirroring the Phase 1 /
`PHASE1_TODO.md` split. This section is the rolled-up summary. All milestones complete and verified:
migrations applied and drift-checked, full unit (73) and integration (113, across 18 files) suites
green, typecheck/lint/format clean, both API and web production builds succeed, and a full
HTTP-level golden-path walkthrough exercised every cross-module flow below against a real running
API + worker instance (see 2K in `docs/PHASE2_TODO.md` for the complete verification record).

Entities: `Customer`/`Contact`, `ContactAddress`, `ContactTaxId`, `Item`, `ItemPrice`, `Unit`, `Category`,
`Quote`, `QuoteLine`, `SalesOrder`, `SalesOrderLine`, `Invoice`, `InvoiceLine`, `RecurringInvoiceTemplate`,
`RecurringInvoiceTemplateLine`, `CreditNote`, `CreditNoteLine`, `CreditNoteAllocation`,
`CreditNoteRefund`, `PaymentReceived`, `PaymentAllocation`, `DocumentSnapshot` (build spec §4;
blueprint §9).

### Data model

- [x] `Contact` (customer) with type, display/legal name, email/phone, billing/shipping addresses, tax
      IDs, currency, terms, receivable account link, tags, active/inactive
- [x] `Item`/`ItemPrice`/`Unit`/`Category` catalog (item vs service vs non-stock type)
- [x] `Quote` + `QuoteLine`, `SalesOrder` + `SalesOrderLine`, `Invoice` + `InvoiceLine`
- [x] `RecurringInvoiceTemplate` + `RecurringInvoiceTemplateLine` (cadence, start/end, next-run,
      auto-create/send flags)
- [x] `CreditNote` + `CreditNoteLine` (+ `CreditNoteAllocation`, `CreditNoteRefund`)
- [x] `PaymentReceived` + `PaymentAllocation`
- [x] Migrations written, applied, and drift-checked in both directions (no difference)

### Backend/API

- [x] Customers module: CRUD, active/inactive toggle, currency default with permission-gated override
- [x] Catalog module: items/services, price lists, revenue-account default, free-description mode toggle
- [x] Quotes: state machine Draft → Pending Approval → Approved → Sent → Accepted/Declined/Expired →
      Converted; convert-to-Invoice action (convert-to-SalesOrder was not part of the final scope —
      Quotes and Sales Orders each convert independently to Invoice)
- [x] Sales Orders: state machine Draft → Approved → Confirmed → Partially Fulfilled → Fulfilled/Cancelled
- [x] Invoices: state machine Draft → Issued → Partially Paid → Paid/Void; issue posts AR + revenue +
      tax through the existing ledger posting engine (`LedgerService.postJournalFromLines`)
- [x] Recurring Invoices: idempotent scheduler with occurrence keys; each generated child invoice
      individually auditable; no cron in the stack — `run-due` is a permission-gated trigger endpoint
- [x] Credit Notes: state machine Draft → Issued → Applied/Refunded/Void; over-allocation guard on
      both allocation and refund
- [x] Payments Received: unapplied/partially applied/applied allocation states; posts cash/bank vs AR
      once at recording time
- [x] Customer Statements: derived from AR subledger by replaying the same events that maintain
      `Invoice.balanceMinor`; totals reconcile to `sum(Invoice.balanceMinor)` by construction
- [x] PDF generation pipeline (immutable snapshot of issued document, rendered via Playwright) + email
      delivery via the existing BullMQ queue infra, consumed by the separate worker process
- [x] Wired the `SALES` role's real permission set in `roles-catalog.ts` — forward-workflow keys
      (manage/issue/convert/record/send) without the money-moving/reversing ones (void, allocate,
      refund, approve), which stay with ADMIN/ACCOUNTANT
- [x] Extended `contracts` package with Zod schemas for every entity/endpoint above

### Invoice line editor rules

- [x] Item/service selectable, with configurable free-description mode
- [x] Description snapshot copied onto the document at creation time
- [x] Quantity must be decimal > 0 unless credit/adjustment flow explicitly allows otherwise
- [x] Unit price at fixed precision; price-list/default may prefill
- [x] Discount configurable at line level
- [x] Tax rate/exemption captured as a snapshot (reuse Phase 1 tax-snapshot pattern)
- [x] Revenue account defaults from item; override is permission-controlled
- [x] Optional project/tag dimension per line for reporting

### UI

- [x] Customers list/create-edit/detail
- [x] Quotes list/create-edit/detail incl. accept/decline
- [x] Sales Orders list/create-edit/detail
- [x] Invoices list/create-edit/detail incl. issue/send/void/record-payment
- [x] Recurring Invoices management screen
- [x] Credit Notes list/create-edit/detail
- [x] Payments Received list + allocation UI
- [x] Customer Statements screen (`/customers/[id]/statement`)
- Global quick-create entries deferred (not implemented as a separate cross-module affordance;
  each resource has its own list-page "create" action instead) — not a blocker for later phases

### Tests/acceptance

- [x] Unit/integration tests per state machine (quote/SO/invoice/credit-note transitions,
      illegal-transition rejection)
- [x] Integration test: invoice issue posts correct AR/revenue/tax journal lines and balances
- [x] Integration test: payment allocation cannot over-apply against an invoice (including a
      concurrent-race variant)
- [x] Integration test: recurring invoice scheduler is idempotent under duplicate trigger, and
      correctly clamps month-end/leap-day cadence advances
- [x] Permission tests for the `SALES` role and view-only roles, via the shared
      `authorization-boundary.int.test.ts` controller-metadata-contract approach (eight-role matrix,
      every organization-scoped endpoint including Statements)
- [x] Cross-module acceptance scenario 1 (service business, build spec §18.1) passes through the AR/GL
      portion over real HTTP (bank-match/reconcile portion still depends on Phase 5)
- [ ] Cross-module acceptance scenario 4 (credit flow, build spec §18.4) passes end to end

---

## Phase 3 — Purchases ✅

Mirror of Sales on the payable side (build spec §5; blueprint §9).

Full milestone-by-milestone detail (3A–3H) lives in `docs/PHASE3_TODO.md`, mirroring the Phase 2 /
`PHASE2_TODO.md` split. This section is the rolled-up summary. All milestones complete and verified:
the single accumulated migration applied and drift-checked in both directions (no difference), full
unit (74) and integration (215, across 27 files) suites green, typecheck/lint/format clean, both API
and web production builds succeed, and a full HTTP-level golden-path walkthrough exercised
purchase→bill→payment against a real running API + worker instance on a fresh synthetic organization
(see "After 3H" in `docs/PHASE3_TODO.md` for the complete verification record, including the three
stale Phase 1/2 test pins the pass caught and fixed).

### Data model

- [x] `Vendor` (identity, contacts, tax IDs, currency, payment terms, payable account link)
- [x] `PurchaseOrder` + `PurchaseOrderLine`
- [x] `Bill` + `BillLine`
- [x] `Expense`
- [x] `RecurringBillTemplate`/`RecurringExpenseTemplate`
- [x] `VendorCredit` + `VendorCreditLine`
- [x] `PaymentMade` + `PaymentAllocation` (payable side)
- [x] Migration written; application and drift check stay with the deferred verification pass

### Backend/API

- [x] Vendors module: CRUD, active/inactive, duplicate-vendor warning
- [x] Purchase Orders: state machine Draft → Approval → Issued → Partially Received/Billed → Closed/Cancelled
- [x] Bills: posting credits AP and debits expense/inventory/asset/tax accounts via `LedgerService`
- [x] Expenses: represent immediately-paid spend; approval configurable
- [x] Recurring Bills/Expenses: idempotent generation with failure reporting
- [x] Vendor Credits: apply against open bills; over-allocation guard
- [x] Payments Made: posts AP debit and cash/bank credit
- [x] Expense categories mapped to chart-of-accounts entries
- [x] Wire the `PURCHASES` role's real permission set (currently a placeholder)
- [x] Extend `contracts` package for every entity/endpoint above

### UI

- [x] Vendors list/create-edit/detail
- [x] Purchase Orders list/create-edit/detail
- [x] Bills list/create-edit/detail incl. attachments
- [x] Expenses list/create-edit/detail incl. receipt attachment
- [x] Recurring Bills/Expenses management screen
- [x] Vendor Credits list/create-edit/detail
- [x] Payments Made list + allocation UI
- [x] Global quick-create entries: Vendor, Expense, Bill, Purchase order, Payment made

### Tests/acceptance

- [x] Unit tests per state machine (PO/bill transitions, illegal-transition rejection)
- [x] Integration test: bill posting produces correct AP/expense/tax journal lines and balances
- [x] Integration test: vendor payment allocation cannot over-apply
- [x] Integration test: recurring bill/expense generation is idempotent
- [x] Permission tests for the `PURCHASES` role
- [x] Cross-module acceptance scenario 2 (retail business, build spec §18.2) passes through the
      purchase→bill→payment portion

---

## Phase 4 — Accounting Engine (beyond Foundation) ✅

Foundation already delivered chart of accounts, manual journals, posting engine, trial balance, and
reversal (Phase 1, Milestone 1G). This section covered the remainder from build spec §6 and
blueprint §10.

Full milestone-by-milestone detail (4A–4G) lives in `docs/PHASE4_TODO.md`. All milestones complete
and verified: five accumulated migrations applied and drift-checked in both directions (no
difference), unit suites 74 (api) + 25 (accounting-core) + 7 (localization) + 5 (ui) green,
integration suite 238 tests across 32 files green (including the extended eight-role boundary
matrix), typecheck/lint/format clean, both production builds succeed. Scoping decisions were made
explicitly up front via plan mode and are recorded in `PHASE4_TODO.md` (posting-rule library =
option (c): library + Phase 4 postings + InvoicesService pilot only; Recurring Journal built now;
testing deferred to the end-of-phase pass).

- [x] Posting-rule library: declarative source event → validated rule → journal lines, atomic,
      idempotent, source-to-ledger traceable (`journals.posting_rule` = `event@vN`), built on top of
      `postJournalFromLines`; used by all four new posting flows plus the invoice pilot
- [x] Opening Balances wizard: account-level lines + contact-level AR / vendor-level AP party
      detail (party lines are the only path to the control accounts) + inventory opening as an
      ordinary line; balanced-import validation hard-gates finalize; idempotent per batch; void with
      exact reversal guarded against later activity (`accounts.opening_balances.manage`, already
      reserved — no new key)
- [x] Recurring Journal: template + cadence + start/end; generated entries unique per schedule
      occurrence via a dedicated claim namespace (`journals.recurring.*`)
- [x] FX Revaluation: batch restating foreign-currency monetary balances at the period-end
      reporting rate, posting only the delta to configured `fx_gain`/`fx_loss`; unique per run date;
      distinct from per-transaction `prepareFxPosting` (untouched)
- [x] Rounding policy: per-organization NONE/HALF_UP + cash-rounding unit on OrganizationPreference,
      differences posted to the previously-unwired `rounding` system account through the library
- [ ] Deferred (recorded in PHASE4_TODO): migrating the remaining six hand-rolling services onto
      the posting-rule library

### Canonical posting acceptance tests (build spec §6 table)

- [x] Invoice issue → Dr Accounts Receivable / Cr Revenue + Tax Payable (`invoices.int.test.ts`,
      now through the rule library, assertions unmodified)
- [x] Customer payment → Dr Bank/Cash / Cr Accounts Receivable (`payments.int.test.ts`)
- [x] Bill posting → Dr Expense/Inventory/Asset + Recoverable Tax / Cr Accounts Payable
      (`bills.int.test.ts`)
- [x] Vendor payment → Dr Accounts Payable / Cr Bank/Cash (`payments-made.int.test.ts`)
- [ ] **BLOCKED on Phase 6 (Inventory)** — Inventory cost on sale → Dr Cost of Goods Sold / Cr
      Inventory Asset: deliberately not faked; no inventory subsystem exists yet
- [x] Credit note → Dr Revenue/Tax reversal / Cr Accounts Receivable/customer credit
      (`credit-notes.int.test.ts`)

---

## Phase 5 — Banking & Reconciliation ✅

Entities: `FinancialAccount`, `StatementImport`, `BankTransaction`, `Match`, `Reconciliation`,
`BankRule`, `Transfer` (build spec §7; blueprint §9).

> **Verified 2026-09-02.** `apps/api/test/banking.int.test.ts` (16 tests) covers duplicate
> fingerprints, match double-allocation, categorize/split/exclude posting, same- and
> cross-currency transfers with void-by-reversal, and the reconciliation zero-difference gate,
> lock and reopen. All 43 banking and inventory endpoints joined the authorization-boundary
> matrix. Full gate green: 34 integration files / 258 tests, drift zero both directions, builds
> pass. The one remaining item is the §18.1 end-to-end scenario, noted below.

### Data model

- [x] `FinancialAccount` (name, type, currency, GL mapping, opening balance)
- [x] `StatementImport` + raw import rows
- [x] `BankTransaction` (date, description, amount/debit-credit, reference, duplicate fingerprint)
- [x] `Match`/allocation linking bank transactions to payments/expenses/transfers
- [x] `BankRule` (condition → category/contact/tag suggestion)
- [x] `Reconciliation` (statement start/end, opening/closing balance, cleared transactions)
- [x] `Transfer` (from/to accounts, date, amount, FX/rate if currencies differ)
- [x] Migration written, applied, and drift-checked in CI

### Backend/API

- [x] Financial Accounts: one GL mapping per account; account currency protected after activity
- [x] Statement Import: CSV first; adapter hooks for OFX/QIF; mapping preview; duplicate detection;
      failed-row download
- [x] Transactions: match, categorize, split, transfer, exclude-with-reason; match cannot
      double-allocate a source transaction
- [x] Bank Rules: suggest or auto-apply only when the organization enables it
- [x] Reconciliation: difference must be zero to complete; completed reconciliation is locked;
      controlled undo with audit trail
- [x] Transfers: creates a balanced transfer posting and linked banking records

### UI

- [x] Accounts list/create-edit/detail
- [x] Statement Import wizard (upload → map → validate → preview → import → result)
- [x] Transactions list with match/categorize/split/transfer/exclude actions
- [x] Bank Rules management screen
- [x] Reconciliation screen (statement period, running difference, complete/lock)
- [x] Transfers screen

### Tests/acceptance

- [x] Duplicate-fingerprint detection test on re-import
- [x] Match cannot double-allocate the same source transaction
- [x] Reconciliation completion requires zero difference and locks on completion
- [x] Transfer posting is balanced and linked correctly on both accounts
- [ ] Cross-module scenario: bank import/match/reconcile closes the loop from Phase 2's invoice/payment
      flow (build spec §18.1) — **still open.** `banking.int.test.ts` covers import, match and
      reconcile in isolation, but not the full scenario-1 chain from quote through acceptance,
      invoice, partial and final payment, to P&L/AR/GL agreement. Tracked as Phase 14 scenario 1.

---

## Phase 6 — Inventory

Entities: `Item` (extended), `Warehouse`, `StockMovement`, `InventoryAdjustment`, `ValuationLayer`
(build spec §8; blueprint §9).

### Data model

- [x] `Warehouse` (name, code, address, status)
- [x] Extend `Item` with inventory-tracking flag, sales/purchase accounts, tax defaults
- [x] `StockMovement` (item, warehouse, qty, source, date, cost layer/reference) — append-only
- [x] `InventoryAdjustment` (qty/value adjustment, reason, account, attachment)
- [x] `ValuationLayer` for the organization-selected valuation method
- [x] Migration written and applied during the DB-backed integration pass; CI drift check remains a
      release hardening step

### Backend/API

- [x] Items: service/non-stock items never create stock movements
- [x] Warehouses CRUD
- [x] Stock Movements: append-only derived movement history; always identifies warehouse when tracked
- [x] Adjustments: approval configurable; posts inventory difference to ledger
- [x] Transfers: source/destination warehouse; net organization stock unchanged
- [x] Reorder: threshold, preferred vendor, suggested quantity — advisory only, no auto-purchase in V1
- [x] Valuation: organization-selected supported method; COGS posting on sale
- [x] Wire the `INVENTORY_MANAGER` role's real permission set (currently a placeholder)

### UI

- [x] Items screen (extend Phase 2 catalog with inventory fields)
- [x] Warehouses list/create-edit
- [x] Stock Movements list
- [x] Adjustments list/create-edit
- [x] Transfers screen
- [x] Reorder advisory screen
- [x] Inventory valuation report

### Tests/acceptance

- [x] Stock cannot change without a traceable movement (spec-level invariant)
- [x] Inventory valuation reconciles to the inventory control account under the chosen policy
- [x] Cross-module scenario 2 (retail business, build spec §18.2) passes end to end: purchase →
      bill → payment → stock receipt → sale/invoice → stock issue/COGS → customer payment → inventory
      valuation agrees to GL

---

## Phase 7 — Projects & Time ✅

Entities: `Project`, `ProjectTask`, `TimeEntry`, `ProjectExpense`, `ProjectBudget` (build spec §9;
blueprint §9).

Full milestone-by-milestone detail (7A–7F) lives in `docs/PHASE7_TODO.md`. All milestones complete
and verified: three migrations applied and drift-checked in both directions (no difference), unit
suites green, integration suite 281 tests across 36 files green (including the eight-role boundary
matrix, which picked up the 25 new project endpoints automatically), typecheck/lint/format clean,
both production builds succeed.

Decision D1 landed here: `JournalLine` carries nullable `projectId` and `tagId`, frozen at posting
beside the tax snapshot. Project profitability reads revenue and cost from those posted lines rather
than from a parallel aggregation, so it reconciles to the P&L by construction. Writing the
reconciliation test found that nothing dimensioned the _cost_ side — `ProjectExpense` attaches only
to an already-posted expense, and a posted line is never restated — so `Expense` gained its own
`projectId`, chosen before posting. Without it, margin equalled revenue on every project.

### Data model

- [x] `Project` (customer, name, dates, billing method, budget, status, manager)
- [x] `ProjectTask` (project, name, assignee, estimate, billable default)
- [x] `TimeEntry` (date, project/task, user, hours, billable, rate, note)
- [x] `ProjectExpense` (linked expense, billable markup/rate)
- [x] `ProjectBudget`
- [x] Migration written, applied, and drift-checked in CI

### Backend/API

- [x] Projects: status lifecycle Open/On Hold/Completed/Cancelled
- [x] Tasks: inherit project-level access
- [x] Timesheets: submitted time immutable until rejected/unlocked
- [x] Time Approval: period/user/project entries; approve/reject with comment
- [x] Project Expenses: cannot invoice the same expense twice
- [x] Generate Invoice: select approved unbilled time/expenses → creates invoice lines with source links
      (integrates with Phase 2 invoice creation)
- [x] Profitability calculation: revenue, billed/unbilled time, costs, expenses, margin, drill-down to
      source records
- [x] Wire the `PROJECT_MANAGER` role's real permission set (currently a placeholder)

### UI

- [x] Projects list/create-edit/detail
- [x] Tasks screen within project detail
- [x] Timesheets entry screen (timer + manual entry)
- [x] Time Approval screen
- [x] Project Expenses screen
- [x] Generate Invoice from approved billables flow
- [x] Profitability report/dashboard

### Tests/acceptance

- [x] Approved billable time becomes eligible for invoicing, and only once
- [x] Cannot invoice the same project expense twice
- [x] Cross-module scenario 3 (project business, build spec §18.3) passes end to end: project →
      approved time + expense → generate invoice → record payment → profitability and ledger reconcile

---

## Phase 8 — Globalization (beyond Foundation's localization)

Foundation already delivered the country-pack contract, one demonstration pack (Kenya), a generic
fallback, and currency/date/number formatting (Phase 1, Milestone 1F). Remaining items from build spec
§10, §19; blueprint §11.

### Data model

- [x] `CountryPack` as a versioned, publishable DB entity (unique `(code, version)`, status
      DRAFT/PUBLISHED/DEPRECATED, tier TIER_A_REVIEWED/TIER_B_GENERIC/TIER_C_BLOCKED, JSONB
      defaults/notes/supportedEntityTypes) — seeded from `jurisdiction-catalog.ts` per D3
- [x] `TaxPack` versioned under each pack (rates, registration fields, exemptions, reporting mappings)
- [x] `DocumentRule` per pack + document type (legal fields, numbering constraints, labels, footer text)
- [x] `StructuredInvoice` — canonical JSON data artifact stored separately from the PDF-render
      `DocumentSnapshot`, with its own `payloadSchemaVersion`
- [x] Migration `20260903140000_add_phase8_globalization` written via the documented shadow-db
      `migrate diff` dance, applied, and drift-checked empty

### Backend/API

- [x] Country-pack CRUD + version/publish/deprecate behind a `PlatformAdminGuard` (interim
      `PLATFORM_ADMIN_EMAILS` allowlist until Phase 12's superadmin auth); one-way DRAFT→PUBLISHED→DEPRECATED
      lifecycle; published packs read-only, deprecated packs never re-published (version is the fix)
- [x] Tier A/B/C enforcement on compliance-sensitive TAX setup (tax-registered or identifier):
      rejected with 400 for Tier C/unknown packs — never imply compliance where unreviewed
- [x] Per-organization compliance status derived at read time from the pinned pack (`CountryPackStore.resolveCompliance`):
      Tier A published → FULLY_REVIEWED, Tier B → GENERIC_CONFIGURATION, Tier C/unknown → UNSUPPORTED;
      surfaced as `compliance` on every org detail response via `packages/contracts`
- [x] Locale/i18n string catalog in `packages/localization` (`enStrings` base bundle + `resolveStrings`
      with honest base-bundle fallback); org settings render compliance badges and a language-fallback note
- [x] Finalized transactions freeze the active country pack version at issue time (`issueInvoice`/`issueBill`
      write `countryPackCodeSnapshot`/`countryPackVersionSnapshot` once inside the issue transaction);
      the structured-invoice artifact is also persisted in the same transaction

### UI

- [x] Compliance-status badge + pinned-pack block in organization settings (between Jurisdiction and Accounting)
- [x] Language-fallback note in the locale switcher (surfaces `settings.language.fallback` when `fallbackUsed`)

### Tests/acceptance

- [x] Structured invoice round-trips and stays independent of PDF rendering (`structured-invoice.int.test.ts`:
      canonical artifact at issue time, no render step required, artifact frozen when pack later edited)
- [x] Unsupported-jurisdiction compliance claims never render (`compliance-claims.int.test.ts`: TAX setup
      blocked for unknown pack, detail surfaces UNSUPPORTED with no fabricated pack name)
- [x] Country-pack version pinned at issue does not change when the pack is later edited
      (`invoices.int.test.ts` pin test + `country-packs.int.test.ts` acceptance test)

---

## Phase 9 — Reporting

**Status: complete and verified (2026-09-04).** The 40 report definitions, export paths, saved
reports, shared UI, report reconciliation tests, and permission boundary are implemented. Scheduled
delivery is intentionally deferred to Phase 10 Automation; the detailed close-out record is
`docs/PHASE9_TODO.md`.

Report families from build spec §11; blueprint §12. Trial Balance and Account Ledger inquiry already
exist from Phase 1 (part of the ledger module, not a general reporting engine).

### Backend/API — report engine

- [x] General reporting engine: date/basis (cash vs accrual, only where accounting logic supports it),
      currency, dimensions/tags, comparison periods, drill-down to source transactions
- [x] CSV/XLSX/PDF export architecture
- [x] Saved filters; scheduled delivery is deferred to Phase 10 Automation

### Reports to implement

- [x] **Financial**: Profit & Loss, Balance Sheet, Cash Flow, Trial Balance (exists), General Ledger,
      Journal Report
- [x] **Receivables**: AR Aging Summary/Detail, Customer Balances, Invoice Details, Payments Received
- [x] **Payables**: AP Aging Summary/Detail, Vendor Balances, Bill Details, Payments Made
- [x] **Sales**: Sales by Customer, Item, Period, Salesperson/tag
- [x] **Purchases**: Purchases/Expenses by Vendor, Category, Period
- [x] **Tax**: Tax Summary, Tax Detail, taxable/exempt bases, liability/recoverable views
- [x] **Inventory**: Stock on Hand, Valuation, Movements, Adjustments, Reorder
- [x] **Projects**: Time, Unbilled Time/Expenses, Revenue/Cost, Profitability
- [x] **Audit**: Transaction history, user activity, approvals, void/reversal history

### UI

- [x] Report Library / Saved Reports navigation section; scheduled reports arrive in Phase 10
- [x] Standard Report filter/comparison/drill-down/export UI shared across all reports above

### Tests/acceptance

- [x] Every report has a source-of-truth definition and a reconciliation test (P&L/Balance Sheet tie to
      trial balance; AR/AP aging tie to control accounts; inventory valuation ties to inventory control
      account)
- [x] Base-currency financial statements reconcile against underlying transaction-currency postings

---

## Phase 10 — Automation & Approvals

**Status: complete and verified (2026-09-05), with named tracked debt.** Detailed decisions,
sequencing, migration strategy, and acceptance gates are in `docs/PHASE10_TODO.md` and
`docs/EXECUTION_PLAN.md` Stage 8. The full gate is green: format, lint, typecheck, 117 unit + 335
integration tests, zero migration drift in both directions plus shadow-database migration replay,
and both production builds. Carried forward as tracked debt, following the Phase 1 precedent: the
Quote bespoke approval route is not yet an adapter into the policy engine; the 10H approval
edge-case tests (multi-level ordering, criteria boundaries, concurrent decisions, mid-flight policy
edits, revoked permissions); the two deliberately-deferred 10F refactors (export streaming, async
`202` oversized-PDF export); the 10E `runDueTemplates` unification; two 10A contract schemas; and
the 10I operator-facing docs.

Build spec §12; blueprint §13.

### Data model

- [x] `ApprovalPolicy` (module, condition/threshold, chain definition)
- [x] `ApprovalRequest` (submitter, target document, chain state, comments, history)
- [x] `WorkflowRule` (trigger, conditions, actions)
- [x] `ScheduledJob` generalization for recurring transactions/reports beyond the current email queue
- [x] `Notification` + per-user notification preferences

### Backend/API

- [x] Approvals: no-approval / simple / multi-level / criteria-based policies
      (no `submitter role` condition; tag/project criteria cannot match any target today — see
      `docs/PHASE10_TODO.md` 10C)
- [x] Approval targets: quotes, sales orders, invoices, credit notes, POs, bills, payments made,
      inventory adjustments, journals — each configurable independently
- [x] Rule engine: trigger + conditions + actions, permission-aware; start with safe actions
      (notifications, field updates, task creation)
      (notification + task actions shipped; the field-update safe action is deliberately scoped
      out — see `docs/PHASE10_TODO.md` 10D)
- [x] Reminders: before-due/on-due/overdue schedules; email template; stop when paid/void
- [x] Recurring engine: shared implementation consumed by invoices, bills, expenses, journals, with
      idempotent occurrence keys (consolidate the per-module recurring logic sketched in Phases 2–4)
      (handlers run through the shared scheduler with idempotent occurrence keys; the four modules'
      own due-sweep route remains a second entry point — see `docs/PHASE10_TODO.md` 10E)
- [x] Notifications: in-app + email preference matrix
- [x] Scheduled reports: report + recipients + cadence + format (integrates with Phase 9)
- [x] Failed-job dashboard and retry controls for administrators

### UI

- [x] Approvals inbox (submitter/approver views) — "Tasks/approvals" already stubbed as a nav concept in
      the Overview section per blueprint §5
- [x] Rules management screen
- [x] Reminders configuration screen
- [x] Notifications preference center
- [x] Scheduled reports management screen

### Tests/acceptance

- [x] Approval scenario (build spec §18.7): maker creates transaction → cannot issue before approval →
      approver rejects → maker edits/resubmits → approver approves → issue/post → complete history
- [x] Reminder schedule stops correctly once an invoice is paid or void
- [x] Recurring engine occurrence keys prevent duplicate generation under retry/replay

---

## Phase 11 — Portals & Collaboration

Build spec §13; blueprint §13.

### Data model

- [x] `PortalUser` / customer-scoped access grant (distinct from `OrganizationMember`)
- [x] `Comment` (internal vs customer-visible flag)
- [x] `Attachment` centralized with visibility, portal attribution, signed downloads, and audit data
- [x] Unified `Activity` projection spanning recognised status/email/approval/accounting/user actions

> **Status: implementation complete, verification partial. Phase 11 is not closed.**
> `docs/PHASE11_TODO.md` holds the evidence ledger, the eleven defects this pass found and fixed,
> and the exact list of gates that have not been run. Boxes below are ticked only where a captured
> result supports them.

### Backend/API

- [x] Customer Portal API: scoped documents, signed PDF downloads, statements and CSV statement
      export, quote decisions, comments/files, and permitted customer-profile fields; no online
      checkout
- [x] Accountant Access: dedicated role, multi-organization switcher (extends the existing
      `organization-switcher.tsx`), journals/reconciliation/reports/close permissions. Covered by
      the accountant multi-client tests in `collaboration.int.test.ts`.
- [x] Comments: internal by default; explicit customer-visible flag
- [x] Attachments: upload/download with permission checks and audit trail. A listing carries no URL;
      a re-authorized download endpoint issues the short-lived link, on the generic route and on the
      Bills/Expenses adapters alike.
- [x] Activity: unified timeline projection with stable cursor pagination, written in the same
      round trip as the audit event it projects

### UI

- [x] Customer-facing portal shell (separate auth/branding surface from the internal app), landing
      portal sign-ins on `/portal` rather than the internal dashboard
- [x] Portal document-detail screens, confirmed quote-decision controls, statement detail with a
      date window and CSV export, and full billing/shipping address editing
- [x] Accountant multi-org switcher with role labels, search, and a safe post-switch destination
- [x] Roll the reusable Comments/Files/Activity component out to every current transaction-detail
      screen, with internal/customer-visible controls where eligible — all twelve detail routes
- [ ] Browser-verify the accessible loading, empty, error, revoked, keyboard, and responsive states.
      They are implemented and asserted in the E2E spec, but no browser run has happened.

### Tests/acceptance

- [x] Add and pass the dedicated portal boundary matrix: tenant/contact isolation across documents,
      PDFs, statements, comments, files, activity, and shared identities. (29/29 captured.)
- [x] Add and pass customer-visible comment/attachment filtering, lifecycle, invitation,
      revocation, rate-limit, download-authorization, cursor, and quote-concurrency coverage.
      (21/21 captured.)
- [x] Add and pass accountant multi-client switching/no-cached-data-leakage coverage.
- [x] Extend the internal authorization-boundary matrix to every Phase 11 organization-scoped route.
      (6/6 captured, including the route-discovery synchronization check.)
- [ ] Run the managed-server Playwright gate, then complete keyboard, responsive, visual-baseline,
      and desktop/mobile review. The seed defect that blocked this gate is fixed and the webServer
      timeouts are raised, but the gate has not been run.
- [ ] Complete the full-suite integration rerun, lint, reverse-drift/replay, production-build, and
      frontend design-detector evidence; then roll Phase 11 into the execution plan and handover.

---

## Phase 12 — Platform Admin

Build spec §14; blueprint §14.

**Status: implementation complete, verification partial (2026-09-09).** The 18/18 real-database
smoke pass and static/build gates are green. Automated acceptance coverage remains deferred and
unchecked in `docs/PHASE12_TODO.md` Milestone 12J, so the phase is not closed.

### Data model

- [x] `Plan`/`Entitlement` (feature flags, limits, trial state, future billing fields)
- [x] `FeatureFlag` with global/country/plan/tenant targeting
- [x] Platform-level views over `Organization`, `User`, `SecurityEvent` (cross-tenant, admin-only)

### Backend/API

- [x] Organizations admin: search/filter by status/country/plan/usage/owner/created date;
      suspend/reactivate with safeguards
- [x] Users admin: account status, memberships, security/support metadata
- [x] Plans & Entitlements: feature flags, limits, trial, future billing fields — no payment billing
      integration required for V1
- [x] Country Packs admin: create/version/publish/deprecate (built on Phase 8's `CountryPack` model)
- [x] Tax Definitions admin: manage versioned global/local tax metadata
- [x] Feature Flags admin: global/country/plan/tenant targeting
- [x] Jobs admin: queue health, failed recurring jobs/imports/PDF/email jobs, retry controls
- [x] Security Events admin: admin actions, privilege changes, suspicious events across all tenants
- [x] Product Analytics: activation, first invoice, reconciliation use, retention/module adoption
- [x] Support tooling: read-only access preferred; if impersonation is implemented, require explicit
      authorization, banner, reason, expiry, and audit

### UI

- [x] Platform-admin console (separate from tenant app; role-tiered platform auth boundary)
- [x] Organizations management screen
- [x] Users management screen
- [x] Plans & Entitlements screen
- [x] Country Packs management screen — consolidated at `/platform/country-packs`
- [x] Tax Definitions management screen — the same workbench, matching the nested version model
- [x] Feature Flags management screen
- [x] Jobs/queue health dashboard (extends existing `health.controller.ts`)
- [x] Security Events dashboard
- [x] Product Analytics dashboard

### Tests/acceptance

- [ ] Platform admin has no casual access to tenant financial data (explicit permission/audit boundary)
- [ ] Suspend/reactivate an organization does not corrupt or leak tenant data
- [ ] Feature-flag targeting resolves correctly across global/country/plan/tenant scopes

---

## Phase 13 — AI Layer

Build spec §15; blueprint §13. Every feature ships as a reviewable, attributable, permission-aware
suggestion — never an autonomous ledger mutation.

- [ ] Receipt extraction: extract candidate vendor/date/amount/tax/category; user must review before
      creating/posting (feeds Phase 3 Expenses)
- [ ] Ask your books: permission-filtered natural-language query over the reporting/semantic layer
      (depends on Phase 9's report engine)
- [ ] Explain a number: trace a report figure back to report rows and source transactions
- [ ] Categorization suggestions: suggestion only, unless an explicit user-approved rule exists (feeds
      Phase 10's rule engine)
- [ ] Variance/anomaly insights: advisory, explainable, and dismissible
- [ ] Draft text: descriptions/reminders only; no autonomous financial commitment

### Tests/acceptance

- [ ] Every AI suggestion is attributable to a specific model/run and requires explicit user confirmation
      before any ledger-impacting action occurs
- [ ] AI queries respect the same permission scoping as the underlying data (no cross-tenant leakage
      through a natural-language query path)

---

## Phase 14 — Hardening & Release

Build spec §16; blueprint §17. This is the final release gate across the whole platform — run it
incrementally as each phase lands, then fully before public V1.

- [ ] **Accounting**: golden scenario suite; balanced ledger; subledger/control-account reconciliation;
      period locks; FX cases
- [ ] **Tenant isolation**: automated cross-org authorization tests across API, exports, portal, and jobs
- [ ] **Security**: auth/session/MFA, rate limits, secret handling, dependency scanning, file validation,
      admin controls
- [ ] **Reliability**: backup/restore drill, queue retry/idempotency, disaster procedures, observability
- [ ] **Performance**: large lists, imports, and reports tested with production-like data volumes
- [ ] **Accessibility**: critical journeys keyboard-usable and WCAG 2.2 AA-oriented
- [ ] **Migration/import**: customers, vendors, items, opening balances, and core transaction import
      paths tested
- [ ] **Operations**: monitoring, alerts, runbooks, support/admin tools ready
- [ ] **Launch**: terms/privacy/compliance claims reviewed; selected country packs signed off

### Cross-module acceptance scenarios (build spec §18) — must all pass before public V1

- [ ] 1. Service business: customer → quote → acceptance → invoice → partial payment → final payment →
      bank import/match → reconcile → P&L/AR/GL agree
- [x] 2. Retail business: purchase inventory → vendor bill → payment → stock receipt → sale/invoice →
      stock issue/COGS → customer payment → inventory valuation agrees to GL — proven by
      `apps/api/test/inventory.int.test.ts`
- [x] 3. Project business: project → approved time + expense → generate invoice → record payment →
      profitability and ledger reconcile
- [ ] 4. Credit flow: invoice → partial payment → credit note → allocate credit → remaining balance
      correct in statement, AR aging, and GL
- [ ] 5. Foreign currency: foreign invoice → payment at different rate → realized FX gain/loss posted →
      base-currency reports balance
- [ ] 6. Close period: reconcile → lock → backdated edit/post attempt fails → authorized unlock records
      actor/reason → re-lock succeeds
- [ ] 7. Approval: maker creates → cannot issue before approval → approver rejects → maker
      edits/resubmits → approver approves → issue/post → complete history
- [ ] 8. Tenant security: identical record IDs/guesses from another organization never disclose
      existence or data

---

## Definition of Done (apply to every module before checking a phase complete)

Per build spec §22 and blueprint §19 — treat as a template checklist, run once per module:

- [ ] Product requirements and edge cases approved
- [ ] UX flows and responsive states designed (loading, empty, error, no-permission, archived/void, success)
- [ ] Permission matrix defined and wired into `roles-catalog.ts`/`permission-catalog.ts`
- [ ] Data model/migration reviewed and applied with zero drift
- [ ] Accounting impact explicitly documented and posting-tested where applicable
- [ ] API contract (Zod schema in `contracts`) and validation complete
- [ ] Audit events defined and emitted
- [ ] Automated unit/integration tests included
- [ ] Accessibility and security checks complete
- [ ] Analytics events defined (feeds Phase 12 Product Analytics)
- [ ] Documentation and support notes complete
- [ ] Every accounting-impacting transaction has tested posting AND reversal rules
- [ ] Every report has a source-of-truth definition and reconciliation test
- [ ] Every background job has retry/idempotency behavior

**Recommended build order** (build spec §20; blueprint §16, matches this document's phase numbering):
Foundation → Sales (first complete vertical slice, UI→API→ledger→report) → Purchases (second vertical
slice) → Accounting Engine completion → Banking → Inventory → Projects/Time → Globalization →
Reporting → Automation/Approvals → Portals → Platform Admin → AI Layer → Hardening/Release. Do not
launch until every cross-module reconciliation test in Phase 14 passes.
