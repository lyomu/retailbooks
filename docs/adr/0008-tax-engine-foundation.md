# ADR 0008: Tax engine foundation

- Status: Accepted
- Date: 2026-08-17

## Context

Milestone 1H introduces tax codes, effective-dated rates, deterministic inclusive/exclusive
calculation, and posting-time tax snapshots on top of the 1G double-entry ledger. Before this
milestone the only tax-related data in the system was a single flat `defaultTaxRate`/
`defaultTaxTreatment` pair on `OrganizationPreference` and a single `suggestedTaxRate` per country in
the jurisdiction catalog — neither models multiple tax codes, rate history, or recoverability, and
neither is wired into journal posting. The ledger, fiscal-period, and permission model built in ADR
0004–0007 must extend without changing its established shape: organization-scoped tables, permission
keys added additively, `SecurityEvent` evidence written in the same transaction as the mutation, and
money handled as BigInt minor units end-to-end.

## Decision

- **Tax codes are organization-scoped and seeded lazily**, the same way the 1G chart of accounts is
  seeded: `TaxService.ensureStarterTaxCodes` runs on first `listTaxCodes` and inserts starter codes
  from `tax-code-catalog.ts`, keyed by the organization's country-pack code. Kenya seeds `VAT-STD`
  (16%, exclusive, recoverable, mapped to the existing `2050 Output tax payable` / `1400 Input tax
recoverable` starter-chart accounts), `VAT-ZERO` (0%, exclusive, recoverable), and `VAT-EXEMPT` (0%,
  exclusive, non-recoverable, no account mapping). Every other jurisdiction seeds a single
  non-recoverable `NO-TAX` placeholder, mirroring the existing generic `suggestedTaxRate: 0` default.
  All starter codes remain fully editable afterward and carry `systemSeed: true` only as provenance,
  matching the chart-of-accounts convention.
- **Rates are a separate, append-only, effective-dated table** (`tax_rates`) rather than fields on
  `TaxCode` itself. A rate change is a new row with a new `effectiveFrom`, never an edit to history —
  the same immutability philosophy that makes posted journals append-only. Overlap between a tax
  code's rate ranges is rejected in the service layer (`rangesOverlap`, checked inside the same
  transaction as `createRate`) rather than a database range-exclusion constraint, since no other table
  in this schema uses one and rates are entered manually rather than generated.
- **`treatment` and `recoverable` become immutable on a `TaxCode` once it has posted journal-line
  history**, mirroring `LedgerAccount`'s existing rule that type/normal-balance cannot change once an
  account has posted activity. Name, description, account mappings, and status stay editable always.
- **Tax attaches to a `JournalLine` as a live, draft-editable `taxCodeId` plus six snapshot columns**
  (`taxCodeSnapshot`, `taxTreatmentSnapshot`, `taxRecoverableSnapshot`, `taxRatePercentSnapshot`,
  `taxableAmountMinor`, `taxAmountMinor`) that stay `NULL` on drafts. `LedgerService.postJournal`
  freezes them inside its existing posting transaction, immediately after journal-number allocation and
  before the audit-evidence write, by calling `TaxService.freezeLineSnapshots`. This is deliberate: a
  preparer can change which tax code applies while a journal is still a draft, but once posted the
  applicable rate, treatment, and recoverability must never drift even if the tax catalog changes
  later. Draft-time values are preview-only, served by a stateless `POST .../tax/calculate` endpoint.
- **No auto-balancing.** Selecting a tax code on a line computes and freezes informational tax metadata
  on the line the preparer already entered; it does not synthesize an additional debit/credit line to
  a tax-control account. Phase 1 has no AR/AP/invoicing module to be the unambiguous origin of such a
  line, so inventing that behavior now would be guessing at a UX with no real caller. A later invoicing
  module can reuse the same `packages/accounting-core` tax math and `TaxCode` catalog to auto-generate
  balanced multi-line journals.
- **All tax math is BigInt-only integer arithmetic**, added to `packages/accounting-core` alongside the
  existing ledger-invariant helpers so it stays framework-free and reusable: rate percents parse to an
  integer scaled by 10⁴ (`parseRatePercentToScaled`, matching the `Decimal(7,4)` column precision),
  and `roundHalfUpDivide` rounds ties away from zero via doubled-numerator division to avoid the parity
  bias a naive half-divisor check has on odd denominators. Exclusive calculation adds tax on top of the
  base; inclusive calculation treats the tax component as the residual after rounding the base
  (`splitInclusiveAmount`), so `base + tax` always reconstructs the original total exactly with zero
  float drift. No floating-point value ever touches a tax amount, matching the existing convention for
  ledger money.
- **Reversal does not carry a reversed line's tax snapshot forward.** `reverseJournal` already builds
  its new journal directly as `POSTED` (bypassing the normal draft-then-post flow), and extending it to
  replicate or negate tax snapshots was treated as out of this milestone's explicit scope rather than
  folded in incidentally.
- **Authorization stays additive under ADR 0005**: `tax.codes.view` and `tax.codes.manage` are new
  permission keys, granted to ADMIN and ACCOUNTANT by default (manage) and STAFF (view only). The
  `/tax/calculate` preview endpoint reuses `tax.codes.view` rather than a third key, the same precedent
  as `accountLedger` reusing `reports.view` instead of a dedicated key.
- **The web app ships a working `/tax` surface in this same milestone** — a tax-code list with
  effective-dated rate history and a calculation preview, plus a tax-code selector with live computed
  preview in the journal-line grid — rather than deferring UI to Milestone 1I, following the precedent
  1G set for the ledger UI. The "Tax codes" sidebar item already existed as a dead link from earlier
  milestones; this milestone gives it a real destination.

## Consequences

- A future invoicing or banking module that needs to auto-generate tax lines has a ready calculation
  core (`packages/accounting-core`) and catalog (`TaxCode`/`TaxRate`) to build on, without this
  milestone having guessed at that module's UX.
- Multi-jurisdiction tax codes beyond Kenya's demonstration set remain a per-organization editing task;
  nothing here claims statutory certification, consistent with the rest of the country-pack system.
- Migration `202608180001_tax_engine_foundation` has been written but not applied to PostgreSQL,
  matching the deferral already established for 1D–1G's migrations.
- DB-free tests cover the rounding/inclusive/exclusive calculation matrix, the starter tax-code
  catalog, and effective-date resolution/overlap logic; live-database tests for tenant/permission HTTP
  boundaries and true concurrent rate-creation behavior remain deferred to the agreed verification pass.
