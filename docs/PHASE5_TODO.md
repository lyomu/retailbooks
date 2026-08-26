# RetailBooks Phase 5 (Banking & Reconciliation) implementation checklist

Durable progress record for Phase 5: Banking & Reconciliation. An item is checked once the code is
implemented; this phase is following the user-confirmed rule, **code first, tests later**. During
this session no test files, lint, prettier, `npm test`, or build runs are part of acceptance; the
only verification pass is `tsc --noEmit` in `apps/web`. `docs/BUILD_ROADMAP.md`'s Phase 5 section is
the rolled-up summary and should be synced at close-out.

## Scoping decisions made up front

1. **Backend-first, UI-second.** Backend banking models, services, permissions, contracts, and the
   Prisma migration were completed before the web work began.
2. **Posting through the Phase 4 rule library.** Bank transaction categorization and transfers post
   via `PostingRulesService`; matches link to already-posted source documents and do not create a
   new journal.
3. **Strict reconciliation completion.** A reconciliation can complete only when the computed
   difference is exactly zero minor units; there is no tolerance band.
4. **Tests deferred.** Phase 5 will need a later comprehensive verification pass for duplicate
   import fingerprints, match uniqueness, transfer journals, reconciliation locks, and permission
   boundaries.

## Milestone 5A - Banking schema and migration

- [x] `FinancialAccount`, `StatementImport`, `BankTransaction`, `Match`, `BankRule`,
      `Reconciliation`, `ReconciliationClearedTransaction`, and `Transfer` models added to Prisma
- [x] Banking enums added for account type, import format/status, transaction direction/disposition,
      match target type, reconciliation status, and transfer status
- [x] Migration generated and applied:
      `apps/api/prisma/migrations/20260826091556_add_phase5_banking/`
- [x] Prisma schema validated and client regenerated

## Milestone 5B - Backend services and posting flows

- [x] Financial account CRUD service and controller
- [x] Bank rule CRUD service plus condition-matching engine
- [x] Statement import service with CSV parsing and duplicate fingerprint detection
- [x] Bank transaction workbench actions: categorize, split, exclude, match, unmatch
- [x] Transfer service with cross-currency support and void reversal
- [x] Reconciliation service with start, clear, unclear, complete, and reopen flows
- [x] Banking module registered in the API app module

## Milestone 5C - Permissions and contracts

- [x] Eleven `banking.*` permission keys added to the API catalog
- [x] Read-only baseline receives the five `.view` banking keys
- [x] ADMIN and ACCOUNTANT receive full banking access; SALES and PURCHASES receive none
- [x] Contracts permission schema and permission group enum updated
- [x] Contract schemas, DTOs, response wrappers, and inferred types added for every Phase 5 entity

## Milestone 5D - Web banking workspace

- [x] Financial Accounts screen: list, filter, create, edit, activate/deactivate, GL account link
- [x] Bank Rules screen: list, create/edit, active toggle, condition grid, suggestions
- [x] Transfers screen: list/filter, create/post, void posted transfer
- [x] Statement Import wizard: CSV upload through `apiUpload` with `financialAccountId`, import
      summaries, failed-row review
- [x] Bank Transactions workbench: filter by account/disposition, categorize, split, exclude, match,
      and unmatch
- [x] Reconciliation screen: start, open detail, clear/unclear selected rows, complete with
      zero-difference gate, reopen completed reconciliation with reason
- [x] New Banking nav group wired into `apps/web/src/components/app-shell.tsx` with all six pages
      unconditionally visible; pages self-gate through `ForbiddenState`

## Milestone 5E - Compileability check

- [x] Run `tsc --noEmit` in `apps/web` and keep it clean

## Deferred verification pass

- [ ] Add integration coverage for duplicate-fingerprint detection on re-import
- [ ] Add integration coverage proving matches cannot double-allocate a source document
- [ ] Add integration coverage for bank transaction categorize/split posting
- [ ] Add integration coverage for transfer posting, cross-currency legs, and void reversal
- [ ] Add integration coverage for reconciliation completion lock and reopen flow
- [ ] Extend the authorization-boundary matrix for all Phase 5 controllers
- [ ] Run the full lint, prettier, test, drift, and build pass after the user lifts the code-first
      restriction
