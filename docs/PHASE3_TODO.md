# RetailBooks Phase 3 (Purchases) implementation checklist

This is the durable progress record for Phase 3 — Purchases, the payable-side mirror of Phase 2
(Sales). An item is checked only after its implementation has been verified. Detailed acceptance
evidence should be added to the relevant pull request, commit, or milestone note.
`docs/BUILD_ROADMAP.md`'s Phase 3 section is the rolled-up summary of this file; keep both in sync.

**Testing/verification for this phase was deliberately deferred until the whole phase was coded**
(per explicit instruction, superseding the normally-non-negotiable per-milestone testing rule) — see
`docs/HANDOVER.md`'s §2 for the rationale and risk tradeoff. Concretely: no `tsc`/lint/tests/migration
generation ran per milestone; schema changes accumulated across 3A–3G into one migration generated
during the closing verification pass. **That verification pass has now run to completion** (see
"After 3H" below) and every box in this file is checked as of the closing commit.

Sequencing rationale: 3A (Vendors) precedes everything that references a vendor. 3B (Purchase
Orders) follows since Bills can optionally link back to a PO. 3C (Bills) is the highest-risk,
architecture-proving slice for this phase (multi-line tax-aware AP/expense/tax posting through
`LedgerService`, sign-flipped from Invoices) and also introduces the new Attachments module that 3D
reuses. 3D (Expenses) is independent of Bills but follows for scope grouping (both are "spend"
documents) and needs Attachments from 3C. 3E (Vendor Credits) depends on Bills existing to apply
against. 3F (Payments Made) depends on Bills existing to apply against. 3G (Recurring Bills/
Expenses) depends on Bills and Expenses existing to generate. 3H (role wiring finalization,
contracts sync, quick-create, this doc) is the wrap-up before the closing verification pass.

## Milestone 3A — Vendors

- [x] `Vendor`/`VendorAddress`/`VendorTaxId` models (mirrors `Contact`/`ContactAddress`/
      `ContactTaxId`; `payableAccountId` instead of `receivableAccountId`; reuses the generic
      `ContactStatus`/`ContactAddressKind` enums rather than duplicating them)
- [x] `ContactType.VENDOR` dropped from the `ContactType` enum (now `CUSTOMER`-only); the now-dead
      `type` field removed from `CreateContactDto` and contracts' `createContactDto`
- [x] Migration accumulated into the single Phase 3 migration (see "After 3H")
- [x] `VendorsService`/`VendorsController`/`vendors.dto.ts` (`apps/api/src/purchases/`), mirroring
      `customers.{service,controller,dto}.ts`
- [x] Duplicate-vendor **warning** (not rejection): no DB unique constraint on `Vendor.displayName`;
      `GET .../vendors/check-duplicate?displayName=` (gated on `vendors.manage`) returns
      case-insensitive-name/tax-ID matches; `create()`/`update()` guard server-side too, returning a
      plain `ConflictException` unless `confirmDuplicate: true` is set
- [x] Permissions `vendors.view`/`.manage`/`.currency_override` (group `Purchases`); wired into
      ADMIN/ACCOUNTANT/SALES/PURCHASES roles + `READ_ONLY_BASELINE`
- [x] Contracts: `vendorSchema` family + `permissionKeySchema` entries added;
      `permissionDefinitionSchema`'s `group` enum gap fixed (`'Sales'` and `'Purchases'` both added
      — this was a pre-existing bug unrelated to Phase 3, flagged in the handover's §4)
- [x] `PurchasesModule` registered in `app.module.ts`
- [x] UI: `apps/web/src/components/vendors-workbench.tsx` (list + inline create/edit form +
      duplicate-warning confirm step) + `apps/web/src/app/vendors/page.tsx`; "Purchases" nav group
      added to `app-shell.tsx` with "Vendors"
- [x] Test: duplicate-warning coverage (case-insensitive name match, tax-ID match,
      `confirmDuplicate` bypass on create and rename, check-duplicate endpoint parity, no-op-casing
      rename) — `apps/api/test/vendors.int.test.ts`
- [x] Test: permission-boundary coverage for `vendors.*` in `authorization-boundary.int.test.ts`

Implementation notes (verification pass): the duplicate-warning suite confirms the guard is a
warning-shaped rejection (`ConflictException` naming the conflicting vendor and offering
`confirmDuplicate`), never a silent allow, and that the rejected rename leaves the row unchanged.
Currency-override asymmetry mirrors Customers exactly (SALES role blocked without
`vendors.currency_override`, base-currency create always allowed).

## Milestone 3B — Purchase Orders

- [x] `PurchaseOrderStatus` (DRAFT/APPROVED/ISSUED/CLOSED/CANCELLED) and
      `PurchaseOrderReceiptStatus` (NOT_RECEIVED/PARTIALLY_RECEIVED/RECEIVED, an independent
      manually-set flag — no inventory/stock-movement subsystem backs it in this phase) enums
- [x] `PurchaseOrder`/`PurchaseOrderLine` models (mirrors `SalesOrder`/`SalesOrderLine`); PO lines
      require an explicit `unitPriceMinor` (no default-price fallback — Items only carry a sales
      price list); `billedMinor`/`totalMinor` mirror Invoice's `paidMinor`/`balanceMinor` pattern for
      cross-Bill billing progress
- [x] Numbering allocated at `issue()` (APPROVED→ISSUED), not `approve()` — an intentional
      departure from SalesOrder's approve-time numbering, since POs have the roadmap's extra
      explicit "sent to vendor" step
- [x] `PurchaseOrdersService`/`Controller`/`dto.ts`, private `transition()` helper reused verbatim
      from `SalesOrdersService`
- [x] `PURCHASE_ORDER_DOCUMENT_TYPE` (and, in the same edit, the other four Phase 3 document-type
      constants ahead of need) added to `document-numbering.ts`
- [x] Permissions `purchases.orders.view`/`.manage`/`.approve`/`.issue`; PURCHASES role gets view/
      manage/issue (no `.approve`, mirroring SALES not holding `sales.orders.approve`)
- [x] Contracts: `purchaseOrderSchema` family + permission keys added
- [x] UI: `apps/web/src/components/purchase-orders-workbench.tsx` (list + editor with
      approve/issue/record-receipt/close/cancel actions) + `apps/web/src/app/purchase-orders/**`;
      "Purchase orders" added to the nav group
- [x] Test: state-transition coverage (happy paths DRAFT→APPROVED→ISSUED→CLOSED and ISSUED→CANCELLED,
      cancel-from-DRAFT/APPROVED, illegal-transition rejection for double-approve/premature-issue/
      double-issue/premature-close/cancel-after-close/double-cancel) — `apps/api/test/
purchase-orders.int.test.ts`
- [x] Test: permission-boundary coverage for `purchases.orders.*`

Implementation notes (verification pass): numbering-at-issue is proven directly (orderNumber null
after approve, `PO-` prefix only after issue) plus distinct increasing numbers across orders.
Receipt-status independence is asserted explicitly (RECEIVED while workflow status stays ISSUED).

## Milestone 3C — Bills (+ Attachments infra)

- [x] `BillStatus` enum + `Bill`/`BillLine` models (mirrors `Invoice`/`InvoiceLine`, sign-flipped:
      `accountId` instead of `revenueAccountId`; optional `purchaseOrderId`/`purchaseOrderLineId`
      links; `vendorReference` for the vendor's own bill number vs. `billNumber` which this
      organization allocates)
- [x] `TaxService.resolveForPosting` extended to also return `purchaseTaxAccountId` (additive,
      harmless to existing Sales callers)
- [x] `BillsService#issueBill`/`voidBill` mirror `issueInvoice`/`voidInvoice`'s idempotency-lock/
      row-lock/tax-freeze/post/number-allocate shape exactly, sign-flipped (credits AP, debits
      expense/inventory/asset + recoverable tax via `tax_receivable`); `issueBill` increments the
      linked PO's `billedMinor` in the same transaction, `voidBill` decrements it back
- [x] **Attachments (new ground)**: generic `Attachment` model (polymorphic `entityType`+`entityId`,
      no FK to entity tables — mirrors `DocumentSnapshot`'s existing polymorphic shape); new
      top-level `apps/api/src/attachments/` module (`AttachmentsService` only, no shared
      controller — `BillsController`/`ExpensesController` each own their nested `/attachments`
      routes with their own permission decorators); `@nestjs/platform-express`'s `FileInterceptor`
      used with a local `UploadedFileLike` type (no `@types/multer` dependency); 15MB upload size
      guard; reuses `StorageService` as-is (confirmed already generic, not PDF/Sales-specific)
- [x] Permissions `purchases.bills.view`/`.manage`/`.issue`/`.void`; attachment upload/list fold
      under `.manage`/`.view`, no separate key
- [x] Contracts: `billSchema`/`attachmentSchema` families + permission keys added
- [x] UI: `apps/web/src/components/bills-workbench.tsx` (list + editor with a per-line Account
      select, a PO select scoped to the chosen vendor's ISSUED POs, vendor-reference field,
      attachment upload/list panel) + `apps/web/src/app/bills/**`; `apiUpload()` added to
      `apps/web/src/lib/api.ts`; "Bills" added to the nav group
- [x] Test: integration test proving Bill issue posts correct AP/expense/tax journal lines and
      balances (build spec §5's Phase 3 acceptance requirement) — `apps/api/test/bills.int.test.ts`
      (multi-tax-code bill: DR general_expense 25000 + DR tax_receivable {2000, 250} / CR AP 27250,
      debit total == credit total == 27250)
- [x] Test: attachment upload/list round-trip — `apps/api/test/attachments.int.test.ts` (real bytes
      fetched back from MinIO through the signed URL, storage-key scoping per entity, 15MB
      rejection persists nothing, cross-entity isolation)
- [x] Test: permission-boundary coverage for `purchases.bills.*`

Implementation notes (verification pass): void-with-exact-reversal is proven line-by-line (every
reversed line flips Dr/Cr against the same account), and voiding a bill that has an applied vendor
credit is rejected with direction toward a credit-note-style correction instead. The PO
billedMinor increment/decrement round-trips through issue and void inside their transactions.

## Milestone 3D — Expenses + Expense Categories

- [x] `ExpenseCategory` model (own model, not overloading catalog's `Category`) mapping a category
      to a chart-of-accounts entry
- [x] `ExpenseStatus` enum (DRAFT/PENDING_APPROVAL/APPROVED/POSTED/VOID/CANCELLED) + `Expense`
      model — a single amount/tax row, not a `lines[]` document (build spec §5 lists no "lines" for
      Expenses, just "amount, tax")
- [x] `ExpensesService#post` is the only ledger-touching action (debit category-mapped-account-or-
      `general_expense` + recoverable tax, credit `paidThroughAccount` directly — no AP leg);
      reachable from DRAFT _or_ APPROVED — "approval configurable" implemented as permission-gated
      (`purchases.expenses.post` can post straight from DRAFT), not a new org-settings toggle;
      `voidExpense` mirrors `voidBill`/`voidInvoice` but without a `paidMinor` guard (Expense has no
      partial-payment concept)
- [x] `ExpenseCategoriesService`/`Controller`/`dto.ts` mirror `catalog.service.ts`'s Category CRUD
      pattern; `ExpensesService`/`Controller`/`dto.ts` with nested `/attachments` routes
      (`entityType: 'EXPENSE'`) via the same `AttachmentsService` injection pattern as Bills
- [x] `EXPENSE_DOCUMENT_TYPE` used for `expenseNumber` allocation at post time
- [x] Permissions `purchases.expenses.view`/`.manage`/`.approve`/`.post`/`.void`,
      `purchases.expense_categories.view`/`.manage`; PURCHASES role gets expenses view/manage/post
      (not approve/void) plus full expense-categories access (mirrors SALES's `catalog.manage`)
- [x] Contracts: `expenseSchema`/`expenseCategorySchema` families + permission keys added
- [x] UI: `apps/web/src/components/{expenses-workbench,expense-categories-workbench}.tsx` +
      `apps/web/src/app/{expenses,expense-categories}/**`; "Expenses" and "Expense categories"
      added to the nav group
- [x] Test: integration test proving Expense post produces correct expense/tax journal lines and
      balances — `apps/api/test/expenses.int.test.ts` (category-mapped account vs `general_expense`
      fallback, recoverable-tax leg to `tax_receivable`, explicit no-AP-leg assertion, exact-reversal
      on void, post-from-DRAFT and post-from-APPROVED both reachable, PENDING_APPROVAL blocked)
- [x] Test: permission-boundary coverage for `purchases.expenses.*`/`purchases.expense_categories.*`

Implementation notes (verification pass): the category CRUD suite covers rename/re-map/deactivate
and same-name rejection. Vendor-status guards cover create and draft-update paths symmetrically.

## Milestone 3E — Vendor Credits

- [x] `VendorCreditStatus` (DRAFT/ISSUED/APPLIED/VOID — no REFUNDED; build spec §5 lists no refund
      path for Vendor Credits unlike Credit Notes) + `VendorCredit`/`VendorCreditLine`/
      `VendorCreditAllocation` models (mirrors `CreditNote`/`CreditNoteLine`/`CreditNoteAllocation`
      minus refund, plus `sourceBillId`/`reason` per build spec's "Vendor, source bill, reason,
      lines")
- [x] New system account `vendor_credit` (code 1140, ASSET/debit — the payable-side mirror of
      `customer_credit`'s LIABILITY/credit role) added to `SYSTEM_ACCOUNT_KEYS` and
      `ledger-starter-chart.ts`
- [x] `issueVendorCredit` sign-flips `issueCreditNote` (credits the expense/asset+tax accounts,
      debits `vendor_credit`)
- [x] **`allocate()` is the safety-critical mirror per handover §2's explicit warning** — copied
      `CreditNotesService#allocate`'s lock order (vendor-credit row, then sorted bill rows) and
      _corrected_ two-tier over-allocation guard verbatim: total-requested vs `remainingMinor`, and
      per-bill `amount > bill.balanceMinor` compared against the freshly re-read `balanceMinor`
      directly — never `existingAllocationFromThisVendorCredit + amount`. One journal per bill
      (`DR accounts_payable, CR vendor_credit`). `voidVendorCredit` mirrors `voidCreditNote`.
- [x] Permissions `purchases.vendor_credits.view`/`.manage`/`.issue`/`.void`/`.allocate`; PURCHASES
      role gets view/manage/issue only (mirrors SALES not holding `.void`/`.allocate` either)
- [x] Contracts: `vendorCreditSchema`/`openBillForAllocationSchema` families + permission keys added
- [x] UI: `apps/web/src/components/vendor-credits-workbench.tsx` (list + editor + allocate-against-
      open-bills panel) + `apps/web/src/app/vendor-credits/**`; "Vendor credits" added to the nav
      group
- [x] Test: **the over-allocation guard integration test flagged as the highest-priority test in
      this phase** — `apps/api/test/vendor-credits.int.test.ts` proves both tiers atomically: the
      per-bill guard (`amount` vs freshly re-read `balanceMinor`) and the whole-call guard
      (total vs `remainingMinor`), plus the concurrent race (exactly one of two competing calls
      succeeds; deterministic outcome regardless of lock winner) and same-idempotency-key replay
      (6 concurrent replays -> 1 allocation row, 1 `LedgerIdempotencyKey`)
- [x] Test: permission-boundary coverage for `purchases.vendor_credits.*`

Implementation notes (verification pass): **the handover's #1 deferred-test risk did not materialize
— no bug found.** The dedicated regression test ("does not let a second allocation against the same
bill double-count prior allocations from this vendor credit") pins the corrected guard semantics in
both directions: a legal follow-up allocation (600 then 300 against a 1000 bill, with plenty of
vendor-credit headroom) must _pass_ — which the buggy `existing + amount` shape would wrongly reject,
since the live balance (400) is already net of the first allocation — and a further 101 against the
then-100 balance must be rejected by the per-bill guard despite the vendor credit still having 1100
remaining. Status derivation (ISSUED while partially applied → APPLIED once consumed, bill
PARTIALLY_PAID → PAID) and one-journal-per-allocation (two distinct journals for two calls) are
asserted alongside. Partial application correctly blocks voiding.

## Milestone 3F — Payments Made

- [x] `PaymentMade`/`PaymentMadeAllocation` models (mirrors `PaymentReceived`/`PaymentAllocation`
      sign-flipped; distinct table names since Prisma model names are global). Confirmed
      `PaymentReceived` itself has no method/reference fields despite similar build-spec wording, so
      `PaymentMade` skips them too, following the shipped Sales precedent exactly.
- [x] `record()` mirrors `PaymentsService#record` exactly (creates the row before posting since
      `postJournalFromLines` needs a `sourceId`; posts `DR accounts_payable, CR paidFromAccount`)
- [x] `allocate()` mirrors `PaymentsService#allocate`'s lock order and guard shape verbatim (payment
      row, then sorted bill rows; total vs `unappliedMinor`, each amount vs the freshly re-read
      `bill.balanceMinor`); no new journal per allocation, confirmed via Journal's own back-relations
      that `PaymentAllocation` has none either (unlike `CreditNoteAllocation`/
      `VendorCreditAllocation`, which do)
- [x] Permissions `purchases.payments_made.view`/`.record`/`.allocate`; PURCHASES role gets view/
      record only (mirrors SALES not holding `sales.payments.allocate`)
- [x] Contracts: `paymentMadeSchema` family + permission keys added
- [x] UI: `apps/web/src/components/payments-made-workbench.tsx` (list + record-then-allocate flow) +
      `apps/web/src/app/payments-made/**`; "Payments made" added to the nav group
- [x] Test: integration test for vendor-payment over-allocation rejection + concurrent race —
      `apps/api/test/payments-made.int.test.ts` (per-bill guard atomic, whole-call guard vs
      `unappliedMinor` atomic, PARTIALLY_PAID/PARTIALLY_ALLOCATED derivation across two calls, race
      determinism, same-idempotency-key replay, cross-vendor bill rejected)
- [x] Test: permission-boundary coverage for `purchases.payments_made.*`

Implementation notes (verification pass): recording posts the balanced AP/bank journal once
(`DR accounts_payable / CR bank_default`, 1500 = 1500) and allocation adds no journal, matching the
Sales precedent. The race test pins a deterministic outcome (only one 1000 allocation fits inside a
1200 unapplied balance) independent of which call wins the payment-row lock.

## Milestone 3G — Recurring Bills/Expenses

- [x] `advanceCadence`/`addMonthsClamped` extracted from `recurring-invoices.service.ts` into new
      shared `apps/api/src/common/cadence.ts` (exported); `recurring-invoices.service.ts` updated to
      import from there — no behavior change
- [x] `RecurringBillTemplate`/`RecurringBillTemplateLine` models mirror `RecurringInvoiceTemplate`/
      `Line` exactly (including the same `autoCreate`-means-auto-_issue_ naming, kept for
      consistency); no `autoSend` (Bills are received, not sent)
- [x] `RecurringExpenseTemplate` mirrors Expense's own flat single-amount shape directly (no lines
      sub-table)
- [x] Confirmed no cron/scheduler infrastructure exists anywhere in the codebase — `run-due` stays a
      manually-triggered, permission-gated POST endpoint, matching Sales exactly; no new scheduling
      infra added
- [x] Both `runDueTemplates()` methods mirror `RecurringInvoicesService#runDueTemplates`'s
      `claimOccurrence` atomicity primitive (advisory lock + `LedgerIdempotencyKey` claim) verbatim
- [x] Permissions `purchases.recurring_bills.view`/`.manage`, `purchases.recurring_expenses.view`/
      `.manage` (both full-access pairs, no approve/void split, mirrors
      `sales.recurring_invoices.*`); PURCHASES role gets both pairs in full
- [x] Contracts: `recurringBillTemplateSchema`/`recurringExpenseTemplateSchema` families +
      permission keys added
- [x] UI: `apps/web/src/components/{recurring-bills-workbench,recurring-expenses-workbench}.tsx`
      (list + inline create/edit form + "run due templates now" button; the expense variant is a
      flat form, no line-items grid) + `apps/web/src/app/{recurring-bills,recurring-expenses}/**`;
      both added to the nav group
- [x] Test: idempotent-generation tests (duplicate sweep trigger cannot double-generate for the same
      due occurrence) for both templates — `apps/api/test/recurring-{bills,expenses}.int.test.ts`
      (concurrent `Promise.all` double-trigger yields exactly one child document, exactly one
      occurrence claim in `LedgerIdempotencyKey`, nextRunDate advanced exactly once)
- [x] Test: permission-boundary coverage for `purchases.recurring_bills.*`/
      `purchases.recurring_expenses.*`

Implementation notes (verification pass): month-end clamping (Jan 31 → Feb 28, not Mar 3 overflow)
is covered for both cadence shapes; endDate deactivation deactivates the template when the _next_
occurrence would fall past the end date and a second sweep picks nothing back up; autoCreate=false
produces DRAFT children (bill stays DRAFT; recurring expense generates DRAFT, unlike its default
auto-post behavior mirroring Expenses being post-on-create).

## Milestone 3H — Role wiring finalization, contracts sync, quick-create

- [x] `PURCHASES` role's real permission set fully wired (was built incrementally across 3A–3G, not
      deferred to this milestone as originally planned — audited complete here): forward-workflow
      keys only, same asymmetry pattern as SALES throughout. Cross-checked programmatically:
      `PERMISSION_KEYS` (109 keys) and contracts' `permissionKeySchema` are in exact sync, and every
      key has exactly one `PERMISSION_CATALOG` entry — no drift.
- [x] `apps/api/src/purchases/purchases.module.ts` has all nine controllers/services registered
      (Vendors, PurchaseOrders, Bills, ExpenseCategories, Expenses, VendorCredits, PaymentsMade,
      RecurringBills, RecurringExpenses), plus `AttachmentsModule` imported
- [x] Global quick-create menu — **new ground**: no equivalent existed for Sales either (confirmed
      by search — Phase 2 never built one despite the roadmap listing it), so this is a new,
      minimal `QuickCreateMenu` dropdown added to `app-shell.tsx`'s topbar (reuses the existing
      `Dropdown` primitives), with permission-gated entries for Vendor/Purchase order/Bill/Expense/
      Payment made
- [x] `docs/PHASE3_TODO.md` (this file) created

Implementation notes (verification pass): the exact 24-key PURCHASES set is now pinned by
`permission-resolution.test.ts` ("gives PURCHASES its real Phase 3 forward-workflow permissions"),
including explicit assertions that no `.void`/`.allocate`/`.approve` key appears on the role — see
the stale-pin finding in "After 3H".

## After 3H: the one comprehensive verification pass (deferred per §2 — COMPLETE)

- [x] Accumulate 3A–3G's schema changes into one migration:
      `apps/api/prisma/migrations/20260825140532_add_phase3_purchases/` — 18 new tables, 6 new
      enums, `ContactType` narrowed (no data loss). Applied to the shared dev Postgres via
      `prisma migrate deploy` (non-interactive shell workaround documented in HANDOVER §3).
      Client regenerated cleanly.
- [x] `tsc --noEmit` in `apps/api` and `apps/web`, plus root-level `npm run typecheck` covering all
      seven workspaces (including `packages/contracts`/`packages/ui`, closing the gap noted at
      handover time) — all exit 0.
- [x] `npm run lint` (--max-warnings=0) clean; `prettier --write .` + `prettier --check .` clean
      (zero files changed by --write).
- [x] Deferred test files written (one per milestone, exactly the per-milestone bullets above),
      then `npm test` + `npm run test:integration`: **74 unit tests green (12 files) and 215
      integration tests green (27 files)**, infra up throughout (postgres/redis/minio/mailpit).
- [x] `authorization-boundary.int.test.ts`'s `ENDPOINTS`/`CONTROLLERS` arrays extended for every
      controller/route from 3A–3G (~85 new endpoint cases across the nine controllers, plus the four
      new path-param substitutions); its metadata-sync self-check passes, proving the declared
      matrix matches what the controllers actually declare.
- [x] Migration drift check both directions, zero difference: migrations→schema (via recreated
      `retailbooks_shadow`, dropped immediately after) and live-db→schema, both `--exit-code` 0.
- [x] `npm run build` at root (`build --workspaces --if-present`): API nest build + web Next.js
      production build (51 routes incl. all nine new Phase 3 page groups) succeed.
- [x] Real HTTP-level golden-path verification pass against a running instance: isolated API +
      worker on scratch port 3901 against the shared dev Postgres, fresh synthetic organization
      (per the demo-role staleness guidance in HANDOVER §4), real signup → Mailpit verification
      token round-trip → login cookie → org finalize → fiscal year → vendor → PO draft/approve/
      issue/receipt → bill linked to the PO → issue → payment made → full allocation → bill PAID →
      trial balance fetched and balanced (DR 12000 == CR 12000 net after the AP legs wash out).
      26/26 checks passed (build spec §18.2 scenario 2, purchase-side portion; stock/COGS parts out
      of scope until Inventory). All synthetic rows deleted afterward (3 organizations cascaded, 4
      standalone users; verified 0 remain).

### Findings fixed during the pass (stale Phase 1/2 pins, not Phase 3 bugs)

Each of these is a test pinning pre-Phase 3 reality that Phase 3 legitimately changed; updated to
pin the new intended state, wrong-vs-right spelled out per the 2E convention:

1. **`system-account-keys.test.ts` — "fourteen keys" pin.** Wrong: expected the Phase 1 key list,
   so adding the intentional `vendor_credit` system account (3E) failed it. Right: fifteen keys,
   with `vendor_credit` included; the control-account pin likewise gains `vendor_credit`, which is
   `isControl: true` in `ledger-starter-chart.ts` (code 1140) exactly mirroring `customer_credit`.
2. **`permission-resolution.test.ts` — "still-Phase-1-minimal roles" pin.** Wrong: asserted
   PURCHASES held only `organization.view`, true before 3H wired the role. Right: PURCHASES moved
   out of the minimal loop and gained its own exact-set pin (24 keys, forward-workflow only) in the
   style of the existing SALES pin, plus negative assertions that no `.void`/`.allocate`/`.approve`
   key leaks onto the role.
3. **`authorization-boundary.int.test.ts` — matrix-sweep timeout.** Wrong: the eight-role × ~180
   endpoint sweep ran under vitest's default 30s and timed out once Phase 3 roughly doubled the
   endpoint list (it needs ~51s). Right: explicit 180s timeout on that one test; no permission
   logic changed, and the sweep passes cleanly with the larger budget.
