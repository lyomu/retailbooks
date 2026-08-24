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

## Milestone 2C — Catalog

- [ ] `Unit`, `Category` models
- [ ] `Item` model (sku, name, itemType: GOODS/SERVICE/NON_STOCK, categoryId, defaultUnitId,
      revenueAccountId override, defaultTaxCodeId, freeDescriptionAllowed, status); SKU uniqueness
      enforced at service layer (optional field)
- [ ] `ItemPrice` model (priceListKey, currency, unitPriceMinor)
- [ ] Add `salesFreeDescriptionDefault` to `OrganizationPreference`
- [ ] Migration written, applied, and drift-checked in CI
- [ ] `apps/api/src/sales/catalog.{service,controller}.ts`
- [ ] New permission keys `catalog.view`, `catalog.manage`, same role wiring pattern as 2B
- [ ] Zod schemas in `packages/contracts/src/index.ts`; extend `permissionKeySchema`
- [ ] UI: `apps/web/src/app/catalog/**`
- [ ] Test: `ItemPrice.unitPriceMinor` must be non-negative

## Milestone 2D — Invoices (posting slice)

- [ ] `Invoice` model (contactId, invoiceNumber, status, issueDate, dueDate, currency, exchangeRate,
      subtotal/tax/total/paid/balanceMinor, journalId, voidedAt, sentAt placeholder for 2H)
- [ ] `InvoiceLine` model (itemId, descriptionSnapshot, quantity, unitPriceMinor, discountMinor, full
      tax-snapshot field set matching `JournalLine`'s shape, lineTotalMinor, revenueAccountId,
      projectTag)
- [ ] `InvoiceStatus` enum: DRAFT, PENDING_APPROVAL, ISSUED, PARTIALLY_PAID, PAID, OVERDUE, VOID
- [ ] Migration written, applied, and drift-checked in CI
- [ ] State machine: no generic state-machine class — follow `Journal.status`'s pattern, one service
      method per transition with an inline status guard
- [ ] `LedgerService.postJournalFromLines(...)` helper factored out of `postJournal` for programmatic
      single-call draft-then-post posting (the one new piece of shared ledger surface this phase needs)
- [ ] `invoices.service.ts#issueInvoice`: replicates `postJournal`'s idempotency sequence
      (`operation: 'INVOICE_ISSUE'`), consolidates journal lines by account (one AR debit, one revenue
      credit per distinct revenueAccountId, one tax credit per distinct taxCodeId via
      `accountBySystemKey`), allocates invoice number via 2A, `sourceType='SALES_INVOICE'`
- [ ] `voidInvoice`: only from ISSUED/PARTIALLY_PAID with `paidMinor===0`, calls
      `LedgerService.reverseJournal`
- [ ] New permission keys `sales.invoices.view`, `sales.invoices.manage`, `sales.invoices.issue`,
      `sales.invoices.void`, `sales.invoices.revenue_account_override`; SALES gets view/manage/issue,
      ADMIN/ACCOUNTANT get all five
- [ ] Zod schemas in `packages/contracts/src/index.ts`; extend `permissionKeySchema`
- [ ] UI: `apps/web/src/app/invoices/**` (list with status filters, line editor with item/free-text
      toggle and live tax preview, detail with Issue/Void actions)
- [ ] Money-invariant tests (written alongside, non-negotiable): illegal-transition rejection;
      multi-tax-code issue produces a balanced journal with correct account resolution; same-key
      replay; concurrent-different-keys-on-same-invoice (only one wins); void produces exact reversal

## Milestone 2E — Payments Received + allocation

- [ ] `PaymentReceived` model (contactId, paymentNumber, receivedDate, currency, amountMinor,
      allocatedMinor, unappliedMinor, depositAccountId, journalId, status)
- [ ] `PaymentAllocation` model (paymentId, invoiceId, amountMinor)
- [ ] Migration written, applied, and drift-checked in CI
- [ ] Post once at recording time (cash/bank debit vs AR credit) via `postJournalFromLines`,
      `sourceType='PAYMENT_RECEIVED'`
- [ ] Over-allocation guard: lock payment + target invoice rows, assert
      `sum(requested) <= payment.unappliedMinor` and per-invoice
      `existing + requested <= invoice.balanceMinor`, atomic rejection otherwise
- [ ] Derive `Invoice.status` (PARTIALLY_PAID/PAID) and `PaymentReceived.status` in the same
      transaction
- [ ] New permission keys `sales.payments.view`, `sales.payments.record`, `sales.payments.allocate`
      (SALES/ADMIN/ACCOUNTANT)
- [ ] Zod schemas in `packages/contracts/src/index.ts`; extend `permissionKeySchema`
- [ ] UI: `apps/web/src/app/payments/**` (list + allocation UI against open invoices)
- [ ] Money-invariant tests: over-invoice-balance rejection; over-payment-unapplied rejection across
      multiple invoices in one call (atomic); concurrent-allocation race test

## Milestone 2F — Credit Notes

- [ ] `CreditNote`/`CreditNoteLine` models (same shape as Invoice/InvoiceLine)
- [ ] `CreditNoteAllocation` model (mirrors `PaymentAllocation`)
- [ ] `CreditNoteStatus` enum: DRAFT, ISSUED, APPLIED, REFUNDED, VOID
- [ ] Add `customer_credit` system-account key to `ledger-starter-chart.ts` (customer-credit clearing
      liability account) for the refund-recorded posting path
- [ ] Migration written, applied, and drift-checked in CI
- [ ] Issue posts the reverse of an invoice (debit revenue/tax, credit AR)
- [ ] New permission keys `sales.credit_notes.view/manage/issue/void`
- [ ] Zod schemas in `packages/contracts/src/index.ts`; extend `permissionKeySchema`
- [ ] UI: `apps/web/src/app/credit-notes/**`
- [ ] Money-invariant tests: over-allocation guard (same pattern as 2E); exact-offset
      reversal-correctness test
- [ ] Write and pass cross-module acceptance scenario 4 (build spec §18.4, credit flow) here;
      re-verify in 2K

## Milestone 2G — Quotes + Sales Orders (+ convert-to-Invoice)

- [ ] `Quote`/`QuoteLine` models; `QuoteStatus` enum: DRAFT, PENDING_APPROVAL, APPROVED, SENT,
      ACCEPTED, DECLINED, EXPIRED, CONVERTED
- [ ] `SalesOrder`/`SalesOrderLine` models; `SalesOrderStatus` enum: DRAFT, APPROVED, CONFIRMED,
      PARTIALLY_FULFILLED, FULFILLED, CANCELLED
- [ ] No `journalId` column on either model (structural proof these don't post)
- [ ] Nullable `convertedInvoiceId` link columns
- [ ] Migration written, applied, and drift-checked in CI
- [ ] Convert actions re-snapshot line data into a new DRAFT Invoice via 2D's `createDraft` path
- [ ] New permission keys `sales.quotes.view/manage/approve/convert`,
      `sales.orders.view/manage/approve/convert`
- [ ] Zod schemas in `packages/contracts/src/index.ts`; extend `permissionKeySchema`
- [ ] UI: `apps/web/src/app/quotes/**`, `apps/web/src/app/sales-orders/**` incl. accept/decline
- [ ] Tests: state-machine transitions; conversion-correctness (converted invoice totals exactly
      match source at conversion time)

## Milestone 2H — PDF generation + email delivery

- [ ] `DocumentSnapshot` model (documentType, documentId, storageKey, renderedAt)
- [ ] Migration written, applied, and drift-checked in CI
- [ ] `apps/api/src/sales/document-rendering.service.ts`: render once at issue/send time, immutable
      thereafter, stored via existing S3/MinIO config
- [ ] Reuse the existing BullMQ `email-delivery` queue with new job types (`invoice.send`,
      `credit_note.send`, `quote.send`)
- [ ] Wire `sentAt` + `send` transition on Invoice/CreditNote/Quote
- [ ] New permission key `sales.documents.send`
- [ ] Tests: re-send doesn't re-render (snapshot cache hit); one job enqueued per send call

## Milestone 2I — Recurring Invoices

- [ ] `RecurringInvoiceTemplate` model (contactId, cadence, startDate, endDate, nextRunDate,
      autoCreate, autoSend, lastRunOccurrenceKey, active)
- [ ] `RecurringInvoiceTemplateLine` model (real child table, matching every other line-item model)
- [ ] Migration written, applied, and drift-checked in CI
- [ ] Scheduler (`runDueTemplates()`) reuses the `LedgerIdempotencyKey` mechanism
      (`operation: 'RECURRING_INVOICE_GENERATE'`, occurrence key per due template) so a duplicate
      sweep trigger can't double-generate
- [ ] Generated invoices go through 2D's normal `createDraft`/`issueInvoice` paths — no new posting
      logic
- [ ] New permission keys `sales.recurring_invoices.view/manage`
- [ ] Zod schemas in `packages/contracts/src/index.ts`; extend `permissionKeySchema`
- [ ] UI: `apps/web/src/app/recurring-invoices/**`
- [ ] Money-invariant test (non-negotiable): concurrent double-trigger of `runDueTemplates()` for the
      same due template produces exactly one child invoice

## Milestone 2J — Customer Statements

- [ ] `statements.service.ts#getStatement(orgId, contactId, asOf)` — read-only, derived from
      Invoice/PaymentReceived/CreditNote, no new mutating model
- [ ] New permission key `sales.statements.view` (SALES/ADMIN/ACCOUNTANT/VIEWER)
- [ ] UI: `apps/web/src/app/customers/[id]/statement` (or similar)
- [ ] Test: statement total reconciles exactly to `sum(Invoice.balanceMinor)` for the contact

## Milestone 2K — Phase 2 verification pass (hard gate before Phase 6 can start)

- [ ] Consolidate/re-run all state-machine illegal-transition tests
- [ ] Consolidate/re-run invoice-issue balanced-posting test
- [ ] Consolidate/re-run payment over-allocation test
- [ ] Consolidate/re-run recurring-scheduler idempotency test
- [ ] Permission-boundary tests for SALES/VIEWER across every new Sales endpoint, using the same
      controller-metadata-contract approach as `authorization-boundary.int.test.ts`
- [ ] Cross-module acceptance scenario 1 (build spec §18.1, service business — Customer→Item→
      Invoice→Issue→Payment→Allocation) end-to-end through the AR/GL portion
- [ ] Re-verify cross-module acceptance scenario 4 (credit flow) from 2F
- [ ] Log as open-and-deferred (not silently dropped): Phase 2 visual regression, WCAG review,
      performance/index review on Invoice/InvoiceLine list queries, Sales section of `DESIGN.md` —
      same "verification pass can wait" treatment Phase 1 used; these do not block Phase 3 or later
      phases that don't depend on them

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
