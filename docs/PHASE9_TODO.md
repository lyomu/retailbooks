# RetailBooks Phase 9 (Reporting) implementation checklist

Durable progress record for Phase 9: Reporting, sequenced by `docs/EXECUTION_PLAN.md` Stage 7.
`docs/BUILD_ROADMAP.md` remains the scope authority; this file records implementation and
verification detail and is rolled up with the phase close-out.

## Decisions carried in

**D2 — SQL aggregation.** Financial totals aggregate in PostgreSQL, with `organization_id` on
both `journal_lines` and `journals`. The report registry records a source-of-truth definition and
reconciliation strategy for every report. A report cannot be registered without both.

**Basis is a capability, not a label.** Accrual is supported for every ledger and document report.
Cash basis is exposed only by definitions backed by settled cash movements. Requests for cash basis
on an accrual-only definition are rejected rather than returning accrual numbers under a cash label.

**Currency semantics are explicit.** Financial statements and control-account reconciliations use
base-currency journal amounts. Document reports may use transaction currency and group by currency;
the engine never adds unlike currencies. Comparison runs use the same basis, currency, and dimension
filters as the primary period.

**Saved now, scheduled in Phase 10.** Saved filters/reports ship in Phase 9. Scheduled delivery needs
the Automation event/worker path and stays deferred to Phase 10, as `EXECUTION_PLAN.md` 9D requires.
The report registry and export service are the stable seam the future scheduler will call.

## Milestone 9A — Registry, contracts, schema, and permissions

- [x] Report-definition registry with source-of-truth, columns, supported filters, and reconciliation
- [x] Shared run/query contracts: dates, basis, currency mode, project/tag, comparison, drill-down
- [x] `SavedReport` schema and migration, tenant/user scoped
- [x] `reports.manage` in the permission catalog, roles, and contracts
- [x] Migration applied with zero drift in both directions

## Milestone 9B — Report engine and exports

- [x] SQL-aggregated execution path with pagination and traceable source references
- [x] Comparison-period runs use identical report semantics
- [x] CSV streaming export
- [x] XLSX streaming export
- [x] PDF export through the existing Playwright renderer; oversized PDF runs reject for queueing
- [x] Saved-report CRUD with same-transaction audit events
- [x] Existing trial-balance endpoint retained for compatibility

## Milestone 9C — Report families

- [x] Financial: Profit & Loss, Balance Sheet, Cash Flow, Trial Balance, General Ledger, Journal Report
- [x] Receivables: AR Aging Summary/Detail, Customer Balances, Invoice Details, Payments Received
- [x] Payables: AP Aging Summary/Detail, Vendor Balances, Bill Details, Payments Made
- [x] Sales: by Customer, Item, Period, Salesperson/Tag
- [x] Purchases: by Vendor, Category, Period
- [x] Tax: Summary, Detail, Taxable/Exempt Bases, Liability/Recoverable
- [x] Inventory: Stock on Hand, Valuation, Movements, Adjustments, Reorder
- [x] Projects: Time, Unbilled Time/Expenses, Revenue/Cost, Profitability
- [x] Audit: Transaction History, User Activity, Approvals, Void/Reversal History

## Milestone 9D — Web workspace

- [x] Report Library and Saved Reports navigation
- [x] One shared report shell for filters, comparison, drill-down, save, and export
- [x] Pages self-gate with `ForbiddenState`

## Milestone 9E — Tests and reconciliation

- [x] Registry completeness test: every definition has source-of-truth and reconciliation metadata
- [x] Every report executes against an integration fixture and returns traceable rows
- [x] P&L and Balance Sheet tie to the trial balance
- [x] AR/AP aging tie to their control accounts
- [x] Inventory valuation ties to the inventory control account
- [x] Base-currency statements reconcile to transaction-currency postings
- [x] Boundary matrix covers every reporting endpoint

## Milestone 9F — Close-out

- [x] Full CI sequence green, including migration drift and integration tests
- [x] `docs/BUILD_ROADMAP.md` Phase 9 rolled up in the same commit
- [x] `docs/HANDOVER.md` refreshed
- [x] `docs/EXECUTION_PLAN.md` Stage 7 checked off

## Verification run

- `npm run lint`, `npm run format:check`, `npm run typecheck`, and `npm test` are green.
- Migration drift is zero in both directions using the documented shadow database procedure.
- `npm run test:integration`: 40 files, 298 tests green.
- `npm run build`: API and web production builds green.

The first full integration attempt found residual jobs in the isolated
`retailbooks-integration:email-delivery` Redis namespace. Those verified test-only keys were
cleared, and the full suite was then rerun successfully; no production or development queue keys
were touched.
