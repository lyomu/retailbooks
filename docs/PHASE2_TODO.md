# RetailBooks Phase 2 (Sales) implementation checklist

This is the durable progress record for Phase 2 — Sales, the project's first complete vertical slice
(UI → API → ledger → report). An item is checked only after its implementation has been verified.
Detailed acceptance evidence should be added to the relevant pull request, commit, or milestone note.
`docs/BUILD_ROADMAP.md`'s Phase 2 section is the rolled-up summary of this file; keep both in sync.

Sequencing rationale: 2A (numbering) must precede any numbered document. 2B/2C (Customers, Catalog)
have no mutual dependency but must precede anything that references a contact or item. 2D (Invoices)
comes before Quotes/SalesOrders — it's the highest-risk, architecture-proving slice (multi-line
tax-aware AR/revenue/tax posting through `LedgerService`), proven in isolation against directly-created
invoices before Quotes/SalesOrders are layered on top as non-posting workflow with a convert-to-Invoice
action. 2E (Payments) and 2F (Credit Notes) depend on Invoices and follow next. 2G (Quotes + Sales
Orders) follows once conversion has something to convert into. 2H (PDF + email) is a fast-follow after
three send-capable document types exist, rather than folded into 2D. 2I (Recurring) and 2J (Statements)
depend on Invoices/Payments/CreditNotes. 2K (verification pass) is a hard gate: nothing in Phase 6
(Inventory) may build on unverified Phase 2 posting.

## Milestone 2A — Document numbering generalization ✅

- [x] Add `DocumentNumberingConfig` model (organizationId, documentType, prefix, numberPadding,
      nextNumber, numberingReset; unique on `[organizationId, documentType]`), lazily seeded per
      document type via an atomic `INSERT ... ON CONFLICT` (Prisma's `.upsert()` was not safe under
      genuinely concurrent seeding — see the test note below)
- [x] Add `allocateDocumentNumberWithClient(client, orgId, documentType, at)` to
      `document-numbering.service.ts`, generalizing the existing atomic upsert; kept
      `allocateJournalNumberWithClient` as a thin wrapper so `ledger.service.ts` call sites didn't change
- [x] Add `INVOICE_DOCUMENT_TYPE`, `CREDIT_NOTE_DOCUMENT_TYPE`, `QUOTE_DOCUMENT_TYPE`,
      `SALES_ORDER_DOCUMENT_TYPE`, `PAYMENT_RECEIVED_DOCUMENT_TYPE` constants, plus
      `GENERALIZED_DOCUMENT_TYPES`/`isGeneralizedDocumentType` to keep JOURNAL on its own dedicated
      path and reject unknown types
- [x] Add permission-gated config endpoints generalized to `documentType`
      (`GET/PATCH organizations/:organizationId/numbering/:documentType`, reusing `numbering.view` /
      `numbering.manage` — no new permission keys), registered after the literal `numbering/journal`
      route so it keeps matching first
- [x] Migration `20260824180500_add_document_numbering_config` written, applied, and drift-checked
      (`prisma migrate diff --exit-code`: no difference)
- [x] Test: parallel-allocation gap-free numbering for a non-journal document type, added to
      `accounting-invariants.int.test.ts` — this test caught a real concurrency bug (Prisma's
      `documentNumberingConfig.upsert()` isn't atomic under concurrent first-time seeding of the same
      row; 10 parallel calls threw unique-constraint violations), fixed by seeding via raw SQL
      `INSERT ... ON CONFLICT DO UPDATE` instead, matching the existing `document_number_sequences`
      pattern
- [x] Added matching entries to `authorization-boundary.int.test.ts`'s endpoint matrix; full
      integration suite (54 tests) and unit suite (72 tests) green, typecheck/lint/format clean

## Milestone 2B — Customers/Contacts ✅

- [x] `Contact` model (type, displayName, legalName, email, phone, currency, paymentTermsDays,
      receivableAccountId override, status, tags)
- [x] `ContactAddress` (billing/shipping) and `ContactTaxId` models
- [x] Migration `20260824182525_add_customer_contacts` written, applied, and drift-checked
      (`prisma migrate diff --exit-code`: no difference)
- [x] `apps/api/src/sales/customers.{service,controller,dto}.ts`: CRUD, active/inactive toggle,
      currency default with permission-gated override; new `SalesModule` wired into `app.module.ts`
- [x] New permission keys `customers.view`, `customers.manage`, `customers.currency_override` (new
      `'Sales'` permission-catalog group); wired into `roles-catalog.ts` (SALES: all three; ADMIN: all
      three; ACCOUNTANT: view + manage; VIEWER: view via `READ_ONLY_BASELINE`)
- [x] Zod schemas in `packages/contracts/src/index.ts`; extended `permissionKeySchema`
- [x] UI: `apps/web/src/components/customers-workbench.tsx` + `apps/web/src/app/customers/page.tsx`
      (list, inline create/edit form, deactivate/reactivate) using `DataTable`/`EmptyState`/
      `ForbiddenState` and the `hasPermission()` gate pattern; added to the sidebar nav
- [x] Audit events (`customers.created`/`customers.updated`/`customers.deactivated`/
      `customers.reactivated`) written inside the same transaction as each mutation
- [x] Tests (`apps/api/test/customers.int.test.ts`, 5 tests): duplicate-display-name rejection,
      currency-override permission boundary (both allow and deny sides), cross-tenant isolation
      (customer from another org 404s, not 403); added matching entries to
      `authorization-boundary.int.test.ts`'s endpoint matrix; full suite green (73 unit + 59
      integration), typecheck/lint/format clean, both API and web production builds succeed

## Milestone 2C — Catalog ✅

- [x] `Unit`, `Category` models (Category has a self-relation `parentCategoryId` for nesting)
- [x] `Item` model (sku, name, itemType: GOODS/SERVICE/NON_STOCK, categoryId, defaultUnitId,
      revenueAccountId override, defaultTaxCodeId, freeDescriptionAllowed, status); SKU uniqueness
      enforced at service layer (optional field, `assertSkuAvailable`)
- [x] `ItemPrice` model (priceListKey default `"default"`, currency, unitPriceMinor)
- [x] Added `salesFreeDescriptionDefault` to `OrganizationPreference`; new items default to it unless
      overridden per item
- [x] Migration `20260824184500_add_catalog` written, applied, and drift-checked
      (`prisma migrate diff --exit-code`: no difference)
- [x] `apps/api/src/sales/catalog.{service,controller,dto}.ts`: units/categories/items CRUD,
      item active/inactive toggle; registered in `SalesModule` alongside customers
- [x] New permission keys `catalog.view`, `catalog.manage`; same role wiring pattern as 2B (SALES +
      ADMIN: both; ACCOUNTANT: both; VIEWER: view via `READ_ONLY_BASELINE`)
- [x] Zod schemas in `packages/contracts/src/index.ts`; extended `permissionKeySchema` (caught a real
      gap: the 2B commit added `customers.*` to the API's permission catalog but missed adding it to
      the contracts package's separately-maintained `permissionKeySchema` enum for `catalog.*` — the
      web typecheck failure surfaced it immediately)
- [x] UI: `apps/web/src/components/catalog-workbench.tsx` + `apps/web/src/app/catalog/items/page.tsx`
      (list, inline create/edit with a single default-price field, deactivate/reactivate); added to
      the Sales sidebar nav group. Unit/Category management UI deferred — the backend and contracts
      support them, but no screen exists yet; items can be created without a unit or category today
- [x] Tests (`apps/api/test/catalog.int.test.ts`, 5 tests): SKU-uniqueness rejection, two items with
      no SKU both succeed, free-description-default inheritance, and `ItemPrice.unitPriceMinor`
      non-negative validation at the HTTP boundary (both the rejection and the zero/positive
      acceptance side); added matching entries to `authorization-boundary.int.test.ts`'s endpoint
      matrix; full suite green (73 unit + 64 integration), typecheck/lint/format clean, both API and
      web production builds succeed

## Milestone 2D — Invoices (posting slice) ✅

- [x] `Invoice` model (contactId, invoiceNumber, status, issueDate, dueDate, currency, exchangeRate,
      subtotal/tax/total/paid/balanceMinor, journalId, voidedAt, sentAt placeholder for 2H)
- [x] `InvoiceLine` model (itemId, descriptionSnapshot, quantity, unitPriceMinor, discountMinor, full
      tax-snapshot field set matching `JournalLine`'s shape, lineTotalMinor, revenueAccountId,
      projectTag)
- [x] `InvoiceStatus` enum: DRAFT, PENDING_APPROVAL, ISSUED, PARTIALLY_PAID, PAID, OVERDUE, VOID
- [x] Migration written, applied, and drift-checked in CI
- [x] State machine: no generic state-machine class — follow `Journal.status`'s pattern, one service
      method per transition with an inline status guard
- [x] `LedgerService.postJournalFromLines(...)` helper factored out of `postJournal` for programmatic
      single-call draft-then-post posting (the one new piece of shared ledger surface this phase needs)
- [x] `invoices.service.ts#issueInvoice`: replicates `postJournal`'s idempotency sequence
      (`operation: 'INVOICE_ISSUE'`), consolidates journal lines by account (one AR debit, one revenue
      credit per distinct revenueAccountId, one tax credit per distinct taxCodeId via
      `accountBySystemKey`), allocates invoice number via 2A, `sourceType='SALES_INVOICE'`
- [x] `voidInvoice`: only from ISSUED/PARTIALLY_PAID with `paidMinor===0`, calls
      `LedgerService.reverseJournal`
- [x] New permission keys `sales.invoices.view`, `sales.invoices.manage`, `sales.invoices.issue`,
      `sales.invoices.void`, `sales.invoices.revenue_account_override`; SALES gets view/manage/issue,
      ADMIN/ACCOUNTANT get all five
- [x] Zod schemas in `packages/contracts/src/index.ts`; extend `permissionKeySchema`
- [x] UI: `apps/web/src/components/invoices-workbench.tsx` (`InvoicesPage` list with search and status
      filter; `InvoiceEditorPage` create/edit draft with an item picker + free-text fallback per line,
      quantity/unit-price/discount/tax-code inputs, and a live client-side subtotal preview mirroring
      the journal editor's running-balance UX) plus three routes under `apps/web/src/app/invoices/`
      (list, `new`, `[id]`), following the journals list+editor route split rather than
      customers'/catalog's single-page inline-form pattern, since invoices need a dedicated Issue/Void
      detail view. Added "Invoices" to the Sales nav group in `app-shell.tsx`. Line-level
      `revenueAccountId` override and `projectTag` are deliberately not exposed in the UI yet — the
      backend and contracts support them, same deferral precedent as 2C's unit/category screens.
- [x] Money-invariant tests (written alongside, non-negotiable): illegal-transition rejection;
      multi-tax-code issue produces a balanced journal with correct account resolution; same-key
      replay; concurrent-different-keys-on-same-invoice (only one wins); void produces exact reversal
      (`apps/api/test/invoices.int.test.ts`, 6 tests)
- [x] Full suite green (73 unit + 70 integration), typecheck/lint/format clean, both API and web
      production builds succeed; browser-verified the golden path (customer → item → draft invoice →
      issue → void) against the dev servers, confirming invoice-number allocation, status transitions,
      and the item-picker auto-fill of description/price/tax-code all work end to end with zero
      console errors. Note for future sessions: a long-lived local dev database's demo-org roles can
      go stale relative to `roles-catalog.ts` as new permission keys are added between sessions (roles
      are snapshotted once at org-creation time, not re-synced) — if a demo user gets an unexpected
      `ForbiddenState` on a page whose permission key is newly added, that's the likely cause, not a
      guard bug; reconcile by inserting the missing `role_permissions` rows for that org rather than
      resetting the database.

## Milestone 2E — Payments Received + allocation ✅

- [x] `PaymentReceived` model (contactId, paymentNumber, receivedDate, currency, amountMinor,
      allocatedMinor, unappliedMinor, depositAccountId, journalId, status)
- [x] `PaymentAllocation` model (paymentId, invoiceId, amountMinor)
- [x] Migration `20260825042133_add_payments_received` written, applied, and drift-checked
      (`prisma migrate diff --exit-code`, both directions: no difference)
- [x] Post once at recording time (cash/bank debit vs AR credit) via `postJournalFromLines`,
      `sourceType='PAYMENT_RECEIVED'`
- [x] Over-allocation guard: lock payment + target invoice rows, assert
      `sum(requested) <= payment.unappliedMinor` and per-invoice `requested <= invoice.balanceMinor`
      (see note below), atomic rejection otherwise
- [x] Derive `Invoice.status` (PARTIALLY_PAID/PAID) and `PaymentReceived.status` in the same
      transaction
- [x] New permission keys `sales.payments.view`, `sales.payments.record`, `sales.payments.allocate`
      (SALES: view/record; ADMIN/ACCOUNTANT: all three)
- [x] Zod schemas in `packages/contracts/src/index.ts`; extended `permissionKeySchema`
- [x] UI: `apps/web/src/components/payments-workbench.tsx` + `apps/web/src/app/payments/**` (list,
      record, allocation UI against open invoices)
- [x] Money-invariant tests (`apps/api/test/payments.int.test.ts`, 9 tests): over-invoice-balance
      rejection, over-unapplied rejection across multiple invoices in one call (atomic), concurrent
      allocation race, idempotency replay. The over-allocation guard's original form compared
      `existingAllocationFromThisPayment + requested` against `invoice.balanceMinor` — a real
      double-count, since `balanceMinor` is already net of every prior allocation against that
      invoice (from any payment). The integration suite running for real caught this; fixed to
      compare `requested` directly against the fresh `balanceMinor`.

## Milestone 2F — Credit Notes ✅

- [x] `CreditNote`/`CreditNoteLine` models (same shape as Invoice/InvoiceLine)
- [x] `CreditNoteAllocation` model (mirrors `PaymentAllocation`, but owns a real `journalId` — see
      below) and `CreditNoteRefund` (per-event cash-payout table)
- [x] `CreditNoteStatus` enum: DRAFT, ISSUED, APPLIED, REFUNDED, VOID
- [x] Added `customer_credit` system-account key to `ledger-starter-chart.ts`
- [x] Migration `20260825092302_add_credit_notes_quotes_orders_documents_recurring` (bundled with
      2F–2I's schema additions) written, applied, and drift-checked (both directions: no difference)
- [x] Issue credits `customer_credit` (a liability holding account), not `accounts_receivable`
      directly — a deliberate deviation from the checklist's literal wording, documented in the doc
      comment at the top of `credit-notes.service.ts`. AR is only reduced when the credit is
      _allocated_ to a specific invoice (`DR customer_credit, CR accounts_receivable`, one real
      journal per invoice per allocation call — unlike payments, this is a fresh posting each time,
      not bookkeeping against value that already landed). Refund pays the remainder in cash
      (`DR customer_credit, CR bank_default`).
- [x] New permission keys `sales.credit_notes.view/manage/issue/void/allocate/refund` (SALES gets
      view/manage/issue only — void/allocate/refund reserved for ADMIN/ACCOUNTANT, matching the
      forward-workflow-vs-money-moving asymmetry applied across 2E–2I)
- [x] Zod schemas in `packages/contracts/src/index.ts`; extended `permissionKeySchema`
- [x] UI: `apps/web/src/components/credit-notes-workbench.tsx` + `apps/web/src/app/credit-notes/**`
- [x] Money-invariant tests (`apps/api/test/credit-notes.int.test.ts`, 10 tests): over-allocation
      guard (both single-invoice and whole-call-total forms), over-refund rejection, concurrent
      allocation race, idempotency replay, exact-reversal void, and status derivation
      (ISSUED while partially consumed — there is no `PARTIALLY_APPLIED` value — APPLIED only when
      `remainingMinor` hits zero via allocation, REFUNDED only via refund)
- [x] Cross-module credit flow (issue → partial allocate → refund the remainder, invoice balance
      settles to exactly zero) verified end-to-end over real HTTP against a running API in the 2K
      golden-path pass below, not just at the service layer

## Milestone 2G — Quotes + Sales Orders (+ convert-to-Invoice) ✅

- [x] `Quote`/`QuoteLine` models; `QuoteStatus` enum: DRAFT, PENDING_APPROVAL, APPROVED, SENT,
      ACCEPTED, DECLINED, EXPIRED, CONVERTED
- [x] `SalesOrder`/`SalesOrderLine` models; `SalesOrderStatus` enum: DRAFT, APPROVED, CONFIRMED,
      PARTIALLY_FULFILLED, FULFILLED, CANCELLED — no `CONVERTED` value; converting only sets
      `convertedInvoiceId` and leaves fulfillment status untouched (verified over HTTP below)
- [x] No `journalId` column on either model (structural proof these don't post)
- [x] Nullable `convertedInvoiceId` link columns
- [x] Migration written, applied, and drift-checked (bundled with 2F, see above)
- [x] Convert actions re-snapshot line data into a new DRAFT Invoice via 2D's `createDraft` path.
      `InvoicesService#createDraft` doesn't accept an external transaction, so convert is a two-phase,
      non-atomic call — worst case on failure is an orphaned unlinked DRAFT invoice, never a ledger
      inconsistency, since nothing here posts.
- [x] New permission keys `sales.quotes.view/manage/approve/convert`,
      `sales.orders.view/manage/approve/convert` (SALES gets convert but not approve on either —
      approve is reserved for ADMIN/ACCOUNTANT as a checker step)
- [x] Zod schemas in `packages/contracts/src/index.ts`; extended `permissionKeySchema`
- [x] UI: `apps/web/src/app/quotes/**`, `apps/web/src/app/sales-orders/**` incl. accept/decline
- [x] Tests (`apps/api/test/quotes-and-orders.int.test.ts`, 9 tests): state-machine transitions,
      conversion-correctness (converted invoice totals exactly match source at conversion time),
      confirms sales-order convert doesn't change fulfillment status. Three of these initially failed
      after the 2E–2J migration was applied — the fixture customer had no email, and `QuotesService
#send()` (enhanced in 2H) now requires one; fixed by giving the fixture an email.

## Milestone 2H — PDF generation + email delivery ✅

- [x] `DocumentSnapshot` model (documentType, documentId, storageKey, renderedAt; unique on
      `[organizationId, documentType, documentId]`, so a duplicate row is impossible at the DB level)
- [x] Migration written, applied, and drift-checked (bundled with 2F, see above)
- [x] `apps/api/src/sales/document-rendering.service.ts`: Playwright renders synchronously inside the
      API request (not offloaded to the worker process), so the render and the `DocumentSnapshot`
      cache row land together, avoiding distributed two-phase state
- [x] Reuse the existing BullMQ `email-delivery` queue with new job types (`invoice.send`,
      `credit_note.send`, `quote.send`); the actual send happens in the separate worker process
      (`apps/api/src/worker.ts`) that consumes the queue — confirmed by running the worker process
      during the 2K golden-path pass below and watching real emails with PDF attachments land in
      Mailpit
- [x] Wire `sentAt` + `send` transition on Invoice/CreditNote/Quote. `Quote#send()`'s status guard
      accepts both APPROVED and SENT as valid starting states so a quote can be re-sent
- [x] New permission key `sales.documents.send`
- [x] Tests (`apps/api/test/document-rendering.int.test.ts`, 4 tests): re-send doesn't re-render
      (snapshot cache hit, confirmed both at the DB level and via a second distinct email arriving),
      rejects sending an unemailed customer and a draft invoice

## Milestone 2I — Recurring Invoices ✅

- [x] `RecurringInvoiceTemplate` model (contactId, cadence, startDate, endDate, nextRunDate,
      autoCreate, autoSend, lastRunOccurrenceKey, active)
- [x] `RecurringInvoiceTemplateLine` model (real child table, matching every other line-item model)
- [x] Migration written, applied, and drift-checked (bundled with 2F, see above)
- [x] Scheduler (`runDueTemplates()`) reuses the `LedgerIdempotencyKey` mechanism
      (`operation: 'RECURRING_INVOICE_GENERATE'`, occurrence key per due template) so a duplicate
      sweep trigger can't double-generate. No cron exists in the stack (out of scope); `run-due` is a
      permission-gated endpoint meant for an external trigger, with a "Run due templates now" button
      in the UI for the same purpose.
- [x] Generated invoices go through 2D's normal `createDraft`/`issueInvoice` paths — no new posting
      logic
- [x] New permission keys `sales.recurring_invoices.view/manage`
- [x] Zod schemas in `packages/contracts/src/index.ts`; extended `permissionKeySchema`
- [x] UI: `apps/web/src/app/recurring-invoices/**`
- [x] Money-invariant test (non-negotiable): concurrent double-trigger of `runDueTemplates()` for the
      same due template produces exactly one child invoice
- [x] Fixed a real bug in `advanceCadence()`: it used `Date.prototype.setUTCMonth`/`setUTCFullYear`
      directly, which overflows when the target month is shorter than the source day-of-month (e.g.
      2026-01-31 advanced by one month became 2026-03-03 instead of clamping to 2026-02-28). Replaced
      with a clamped month-add helper; added a regression test
      (`apps/api/test/recurring-invoices.int.test.ts`) covering exactly this month-end case.

## Milestone 2J — Customer Statements ✅

- [x] `statements.service.ts#getStatement(orgId, contactId, { from?, to? })` — read-only, derived
      entirely by replaying the same three events that already maintain `Invoice.balanceMinor`
      incrementally (invoice issue, payment allocation, credit-note allocation), so the closing
      balance reconciles to `sum(Invoice.balanceMinor)` by construction. Superseded the checklist's
      literal single-`asOf` signature with a `from`/`to` date range (product decision, confirmed with
      the user) and a response with both a summary section (opening/closing balance + totals) and a
      full chronological transaction list, including informational rows (payment received, credit
      note issued/refunded) that carry the running balance forward unchanged.
- [x] New permission key `sales.statements.view` (SALES/ADMIN/ACCOUNTANT/VIEWER — pure read access,
      no asymmetry needed)
- [x] UI: `apps/web/src/app/customers/[id]/statement` + a "Statement" action on each customer row
- [x] Test: statement total reconciles exactly to `sum(Invoice.balanceMinor)` for the contact
      (`apps/api/test/statements.int.test.ts`, 6 tests, plus verified again against a live database
      via the HTTP golden path below)
- Known, accepted quirk (not a 2J bug): a voided invoice's `balanceMinor` is never reset by
  `voidInvoice` (void is only permitted while `paidMinor === 0`, so `balanceMinor` still equals
  `totalMinor` at void time and stays there), so a voided invoice permanently contributes its full
  total to a customer's statement balance. The statement faithfully mirrors `balanceMinor` rather
  than "fixing" this independently, since doing so would break exact reconciliation. A real fix
  belongs in `voidInvoice` itself, out of scope here.

## Milestone 2K — Phase 2 verification pass (hard gate before Phase 6 can start) ✅

- [x] Consolidated/re-ran all state-machine illegal-transition tests — full suite green
- [x] Consolidated/re-ran invoice-issue balanced-posting test — green
- [x] Consolidated/re-ran payment over-allocation test — green
- [x] Consolidated/re-ran recurring-scheduler idempotency test — green (plus the new month-end clamp
      regression test)
- [x] Permission-boundary tests for SALES/VIEWER (and all eight system roles) across every new Sales
      endpoint, via `authorization-boundary.int.test.ts`'s controller-metadata-contract approach —
      includes the new `StatementsController` endpoint
- [x] Cross-module acceptance scenario 1 (service business — Customer→Item→Invoice→Issue→
      Payment→Allocation) verified end-to-end through the AR/GL portion, over real HTTP against a
      running API instance (not just the service layer): signup→verify→login→create org→finalize→
      generate fiscal year→create customer→issue two invoices→record a payment→allocate across both
- [x] Re-verified cross-module acceptance scenario 4 (credit flow) from 2F over the same real-HTTP
      run: issue a credit note→allocate part of it→refund the remainder→invoice balance settles to
      exactly zero
- [x] Full deferred verification pass executed and green: migration applied
      (`20260825092302_add_credit_notes_quotes_orders_documents_recurring`) and drift-checked in both
      directions; `tsc --noEmit` clean in `apps/api`, `apps/web`, and `packages/contracts`; `npm run
lint` clean (also fixed two pre-existing lint errors in uncommitted 2E–2I files, unrelated to
      2J, found while closing out this pass); `npm test` (73 unit tests) and `npm run test:integration`
      (18 files, 113 tests) both green; both API and web production builds succeed; a full HTTP-level
      golden-path walkthrough (39 checks) against a real running API + worker instance covered every
      item in the deferred browser-verification list — payments record/allocate/status-flip, credit
      note issue/allocate/refund/status-derivation, quote and sales-order full state machines through
      convert-to-invoice, invoice send with a real PDF attachment landing in Mailpit and a confirmed
      non-duplicating `DocumentSnapshot` on re-send, recurring-invoice run-due generating an invoice
      and advancing `nextRunDate`, and statement reconciliation — run against an isolated
      API/worker pair on a scratch port against the same dev database, with the synthetic
      organization/user data cleaned up afterward. Literal interactive-browser clicking was not
      performed (the project's own Playwright e2e harness has a pre-existing, unrelated
      `clearAuthRateLimits` failure per the handover); the HTTP-level walkthrough exercises the same
      controllers/guards/serialization and real email delivery a browser session would.
- [x] Logged as open-and-deferred (not silently dropped): Phase 2 visual regression, WCAG review,
      performance/index review on Invoice/InvoiceLine list queries, Sales section of `DESIGN.md` —
      same "verification pass can wait" treatment Phase 1 used; these do not block Phase 3 or later
      phases that don't depend on them. Also newly deferred: `voidInvoice` not resetting
      `balanceMinor` (see 2J's note above) — latent, not customer-visible today, but should be fixed
      before statements are relied on for anything voided invoices touch.

## Cross-cutting rules for every milestone

- Standard tenancy shape on every new model: `organizationId` cascade FK, `@@index([organizationId,
...])`, org-scoped compound uniqueness
- Every money-mutating service method wraps in `$transaction` and calls `writeAuditEvent` inside that
  same transaction
- Every new permission key lands in three places: `permission-catalog.ts` (keys + catalog entry),
  `roles-catalog.ts` (role wiring), and `packages/contracts/src/index.ts`'s `permissionKeySchema` enum
- Every new controller: `@Controller('organizations/:organizationId/<resource>')
@UseGuards(SessionGuard, OrganizationGuard)` + per-handler `@RequirePermission(...)`, matching
  `LedgerController`
- Every new screen reuses `packages/ui`'s `EmptyState`/`ForbiddenState`/`Skeleton`/`Toast` and the
  `hasPermission()` gate from `apps/web/src/lib/workspace.ts`
