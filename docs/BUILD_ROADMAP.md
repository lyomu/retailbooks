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

**Status snapshot (2026-08-25):** Phase 1 is functionally complete with hardening/test debt open
(Milestone 1J). Phase 2 (Sales) is complete and verified (Milestones 2A–2K); see
`docs/PHASE2_TODO.md` for full detail. Phase 3 (Purchases) is complete and verified (Milestones
3A–3H); see `docs/PHASE3_TODO.md` for full detail. Phase 4 (Accounting Engine remainder) is complete
and verified (Milestones 4A–4G); see `docs/PHASE4_TODO.md` for full detail. Phases 5–14 have **no
code yet** — confirmed by full-repo search: no modules, Prisma models, routes, or pages exist for
banking, inventory, projects, reporting, automation, portals, platform admin, or AI.

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

## Phase 5 — Banking & Reconciliation

Entities: `FinancialAccount`, `StatementImport`, `BankTransaction`, `Match`, `Reconciliation`,
`BankRule`, `Transfer` (build spec §7; blueprint §9).

### Data model

- [ ] `FinancialAccount` (name, type, currency, GL mapping, opening balance)
- [ ] `StatementImport` + raw import rows
- [ ] `BankTransaction` (date, description, amount/debit-credit, reference, duplicate fingerprint)
- [ ] `Match`/allocation linking bank transactions to payments/expenses/transfers
- [ ] `BankRule` (condition → category/contact/tag suggestion)
- [ ] `Reconciliation` (statement start/end, opening/closing balance, cleared transactions)
- [ ] `Transfer` (from/to accounts, date, amount, FX/rate if currencies differ)
- [ ] Migration written, applied, and drift-checked in CI

### Backend/API

- [ ] Financial Accounts: one GL mapping per account; account currency protected after activity
- [ ] Statement Import: CSV first; adapter hooks for OFX/QIF; mapping preview; duplicate detection;
      failed-row download
- [ ] Transactions: match, categorize, split, transfer, exclude-with-reason; match cannot
      double-allocate a source transaction
- [ ] Bank Rules: suggest or auto-apply only when the organization enables it
- [ ] Reconciliation: difference must be zero to complete; completed reconciliation is locked;
      controlled undo with audit trail
- [ ] Transfers: creates a balanced transfer posting and linked banking records

### UI

- [ ] Accounts list/create-edit/detail
- [ ] Statement Import wizard (upload → map → validate → preview → import → result)
- [ ] Transactions list with match/categorize/split/transfer/exclude actions
- [ ] Bank Rules management screen
- [ ] Reconciliation screen (statement period, running difference, complete/lock)
- [ ] Transfers screen

### Tests/acceptance

- [ ] Duplicate-fingerprint detection test on re-import
- [ ] Match cannot double-allocate the same source transaction
- [ ] Reconciliation completion requires zero difference and locks on completion
- [ ] Transfer posting is balanced and linked correctly on both accounts
- [ ] Cross-module scenario: bank import/match/reconcile closes the loop from Phase 2's invoice/payment
      flow (build spec §18.1)

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
- [x] Migration written, applied, and drift-checked in CI

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

- [ ] Stock cannot change without a traceable movement (spec-level invariant)
- [ ] Inventory valuation reconciles to the inventory control account under the chosen policy
- [ ] Cross-module scenario 2 (retail business, build spec §18.2) passes end to end: purchase →
      bill → payment → stock receipt → sale/invoice → stock issue/COGS → customer payment → inventory
      valuation agrees to GL

---

## Phase 7 — Projects & Time

Entities: `Project`, `ProjectTask`, `TimeEntry`, `ProjectExpense`, `ProjectBudget` (build spec §9;
blueprint §9).

### Data model

- [ ] `Project` (customer, name, dates, billing method, budget, status, manager)
- [ ] `ProjectTask` (project, name, assignee, estimate, billable default)
- [ ] `TimeEntry` (date, project/task, user, hours, billable, rate, note)
- [ ] `ProjectExpense` (linked expense, billable markup/rate)
- [ ] `ProjectBudget`
- [ ] Migration written, applied, and drift-checked in CI

### Backend/API

- [ ] Projects: status lifecycle Open/On Hold/Completed/Cancelled
- [ ] Tasks: inherit project-level access
- [ ] Timesheets: submitted time immutable until rejected/unlocked
- [ ] Time Approval: period/user/project entries; approve/reject with comment
- [ ] Project Expenses: cannot invoice the same expense twice
- [ ] Generate Invoice: select approved unbilled time/expenses → creates invoice lines with source links
      (integrates with Phase 2 invoice creation)
- [ ] Profitability calculation: revenue, billed/unbilled time, costs, expenses, margin, drill-down to
      source records
- [ ] Wire the `PROJECT_MANAGER` role's real permission set (currently a placeholder)

### UI

- [ ] Projects list/create-edit/detail
- [ ] Tasks screen within project detail
- [ ] Timesheets entry screen (timer + manual entry)
- [ ] Time Approval screen
- [ ] Project Expenses screen
- [ ] Generate Invoice from approved billables flow
- [ ] Profitability report/dashboard

### Tests/acceptance

- [ ] Approved billable time becomes eligible for invoicing, and only once
- [ ] Cannot invoice the same project expense twice
- [ ] Cross-module scenario 3 (project business, build spec §18.3) passes end to end: project →
      approved time + expense → generate invoice → record payment → profitability and ledger reconcile

---

## Phase 8 — Globalization (beyond Foundation's localization)

Foundation already delivered the country-pack contract, one demonstration pack (Kenya), a generic
fallback, and currency/date/number formatting (Phase 1, Milestone 1F). Remaining items from build spec
§10, §19; blueprint §11.

### Data model

- [ ] `CountryPack` versioning as a first-class entity (version, status, supported entity types,
      defaults) — currently reference data lives in static `jurisdiction-catalog.ts`, not a
      versionable/publishable DB-backed model
- [ ] `TaxPack` versioning tied to country pack (labels, rates, registration fields,
      inclusive/exclusive rules, exemptions, reporting mappings)
- [ ] `DocumentRule` (required legal fields, numbering constraints, labels, footer/legal text) per country
- [ ] `StructuredInvoice` canonical JSON/XML-ready model, stored separately from the PDF snapshot

### Backend/API

- [ ] Country-pack CRUD/versioning/publish/deprecate (feeds Phase 12 Platform Admin)
- [ ] Additional launch-country tax/document packs beyond Kenya (Tier A: fully reviewed; Tier B: generic
      support without compliance claim; Tier C: blocked from compliance-sensitive setup)
- [ ] Compliance-status flag surfaced per organization/country: Fully reviewed / Generic configuration /
      Unsupported — never imply compliance where unreviewed
- [ ] Locale/i18n string catalog for multi-language UI (locale field exists on organizations today with
      no translation catalog behind it)
- [ ] Finalized transactions retain the country-pack/tax-pack version active when issued (extends the
      existing tax-snapshot pattern)

### UI

- [ ] Country pack indicator/compliance-status badge in organization settings
- [ ] Locale/language switcher (once an i18n catalog exists)

### Tests/acceptance

- [ ] Structured invoice model round-trips correctly and stays independent of PDF rendering
- [ ] Unsupported-jurisdiction compliance claims are never shown in the UI
- [ ] Country-pack version pinned to a transaction does not change if the pack is later edited

---

## Phase 9 — Reporting

Report families from build spec §11; blueprint §12. Trial Balance and Account Ledger inquiry already
exist from Phase 1 (part of the ledger module, not a general reporting engine).

### Backend/API — report engine

- [ ] General reporting engine: date/basis (cash vs accrual, only where accounting logic supports it),
      currency, dimensions/tags, comparison periods, drill-down to source transactions
- [ ] CSV/XLSX/PDF export architecture
- [ ] Saved filters and scheduled report delivery (email; integrates with Phase 10 automation)

### Reports to implement

- [ ] **Financial**: Profit & Loss, Balance Sheet, Cash Flow, Trial Balance (exists), General Ledger,
      Journal Report
- [ ] **Receivables**: AR Aging Summary/Detail, Customer Balances, Invoice Details, Payments Received
- [ ] **Payables**: AP Aging Summary/Detail, Vendor Balances, Bill Details, Payments Made
- [ ] **Sales**: Sales by Customer, Item, Period, Salesperson/tag
- [ ] **Purchases**: Purchases/Expenses by Vendor, Category, Period
- [ ] **Tax**: Tax Summary, Tax Detail, taxable/exempt bases, liability/recoverable views
- [ ] **Inventory**: Stock on Hand, Valuation, Movements, Adjustments, Reorder
- [ ] **Projects**: Time, Unbilled Time/Expenses, Revenue/Cost, Profitability
- [ ] **Audit**: Transaction history, user activity, approvals, void/reversal history

### UI

- [ ] Report Library / Saved Reports / Scheduled Reports navigation section
- [ ] Standard Report filter/comparison/drill-down/export UI shared across all reports above

### Tests/acceptance

- [ ] Every report has a source-of-truth definition and a reconciliation test (P&L/Balance Sheet tie to
      trial balance; AR/AP aging tie to control accounts; inventory valuation ties to inventory control
      account)
- [ ] Base-currency financial statements reconcile against underlying transaction-currency postings

---

## Phase 10 — Automation & Approvals

Build spec §12; blueprint §13.

### Data model

- [ ] `ApprovalPolicy` (module, condition/threshold, chain definition)
- [ ] `ApprovalRequest` (submitter, target document, chain state, comments, history)
- [ ] `WorkflowRule` (trigger, conditions, actions)
- [ ] `ScheduledJob` generalization for recurring transactions/reports beyond the current email queue
- [ ] `Notification` + per-user notification preferences

### Backend/API

- [ ] Approvals: no-approval / simple / multi-level / criteria-based policies
- [ ] Approval targets: quotes, sales orders, invoices, credit notes, POs, bills, payments made,
      inventory adjustments, journals — each configurable independently
- [ ] Rule engine: trigger + conditions + actions, permission-aware; start with safe actions
      (notifications, field updates, task creation)
- [ ] Reminders: before-due/on-due/overdue schedules; email template; stop when paid/void
- [ ] Recurring engine: shared implementation consumed by invoices, bills, expenses, journals, with
      idempotent occurrence keys (consolidate the per-module recurring logic sketched in Phases 2–4)
- [ ] Notifications: in-app + email preference matrix
- [ ] Scheduled reports: report + recipients + cadence + format (integrates with Phase 9)
- [ ] Failed-job dashboard and retry controls for administrators

### UI

- [ ] Approvals inbox (submitter/approver views) — "Tasks/approvals" already stubbed as a nav concept in
      the Overview section per blueprint §5
- [ ] Rules management screen
- [ ] Reminders configuration screen
- [ ] Notifications preference center
- [ ] Scheduled reports management screen

### Tests/acceptance

- [ ] Approval scenario (build spec §18.7): maker creates transaction → cannot issue before approval →
      approver rejects → maker edits/resubmits → approver approves → issue/post → complete history
- [ ] Reminder schedule stops correctly once an invoice is paid or void
- [ ] Recurring engine occurrence keys prevent duplicate generation under retry/replay

---

## Phase 11 — Portals & Collaboration

Build spec §13; blueprint §13.

### Data model

- [ ] `PortalUser` / customer-scoped access grant (distinct from `OrganizationMember`)
- [ ] `Comment` (internal vs customer-visible flag)
- [ ] `Attachment` (already implied by other modules; centralize upload/download/permission/audit here)
- [ ] Unified `Activity` timeline entity spanning status/email/approval/accounting/user actions

### Backend/API

- [ ] Customer Portal: view/download quotes, orders (where exposed), invoices, credit notes,
      statements, receipts; accept/decline quotes; update permitted profile fields; no online checkout
- [ ] Accountant Access: dedicated role, multi-organization switcher (extend the existing
      `organization-switcher.tsx`, currently scoped to internal member org-switching), journals/
      reconciliation/reports/close permissions
- [ ] Comments: internal by default; explicit customer-visible flag
- [ ] Attachments: upload/download with permission checks and audit trail
- [ ] Activity: unified timeline merging status, email, approval, accounting, and user-action events

### UI

- [ ] Customer-facing portal shell (separate auth/branding surface from the internal app)
- [ ] Portal document views: quotes (accept/decline), invoices, credit notes, statements
- [ ] Accountant multi-org switcher and scoped accounting/close screens
- [ ] Comments panel on transaction detail screens (internal/customer-visible toggle)
- [ ] Attachments panel on transaction detail screens
- [ ] Activity timeline component on transaction detail screens

### Tests/acceptance

- [ ] Portal user can only ever see their own organization's documents (tenant + contact-level isolation)
- [ ] Customer-visible comments never leak internal-only comments
- [ ] Accountant role can switch between multiple client organizations without privilege leakage

---

## Phase 12 — Platform Admin

Build spec §14; blueprint §14.

### Data model

- [ ] `Plan`/`Entitlement` (feature flags, limits, trial state, future billing fields)
- [ ] `FeatureFlag` with global/country/plan/tenant targeting
- [ ] Platform-level views over `Organization`, `User`, `SecurityEvent` (cross-tenant, admin-only)

### Backend/API

- [ ] Organizations admin: search/filter by status/country/plan/usage/owner/created date;
      suspend/reactivate with safeguards
- [ ] Users admin: account status, memberships, security/support metadata
- [ ] Plans & Entitlements: feature flags, limits, trial, future billing fields — no payment billing
      integration required for V1
- [ ] Country Packs admin: create/version/publish/deprecate (built on Phase 8's `CountryPack` model)
- [ ] Tax Definitions admin: manage versioned global/local tax metadata
- [ ] Feature Flags admin: global/country/plan/tenant targeting
- [ ] Jobs admin: queue health, failed recurring jobs/imports/PDF/email jobs, retry controls
- [ ] Security Events admin: admin actions, privilege changes, suspicious events across all tenants
- [ ] Product Analytics: activation, first invoice, reconciliation use, retention/module adoption
- [ ] Support tooling: read-only access preferred; if impersonation is implemented, require explicit
      authorization, banner, reason, expiry, and audit

### UI

- [ ] Platform-admin console (separate from tenant app; superadmin-only auth boundary)
- [ ] Organizations management screen
- [ ] Users management screen
- [ ] Plans & Entitlements screen
- [ ] Country Packs management screen
- [ ] Tax Definitions management screen
- [ ] Feature Flags management screen
- [ ] Jobs/queue health dashboard (extends existing `health.controller.ts`)
- [ ] Security Events dashboard
- [ ] Product Analytics dashboard

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
- [ ] 2. Retail business: purchase inventory → vendor bill → payment → stock receipt → sale/invoice →
      stock issue/COGS → customer payment → inventory valuation agrees to GL
- [ ] 3. Project business: project → approved time + expense → generate invoice → record payment →
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
