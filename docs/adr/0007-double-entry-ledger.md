# ADR 0007: Double-entry ledger

- Status: Accepted
- Date: 2026-08-17

## Context

Milestone 1G introduces the first real accounting vertical slice: chart of accounts, draft journals,
posting, reversal, trial balance, account ledger inquiry, and journal inquiry. The ledger must use the
organization tenancy and authorization model from ADR 0004/0005, the fiscal-period and document
numbering services from ADR 0006, and the Phase 1 posture that live PostgreSQL/browser verification is
deferred until the agreed verification pass.

## Decision

- Ledger tables are organization-owned: `ledger_accounts`, `journals`, `journal_lines`, and
  `ledger_idempotency_keys` all carry `organization_id` and are accessed only through
  membership-resolved organization context.
- Chart accounts are flat for 1G, with stable broad code ranges: assets in `1000`, liabilities in
  `2000`, equity in `3000`, revenue in `4000`, expenses in `5000`, cost of sales in `6000`, and other
  income/expense in `7000+`.
- Starter charts are generated from the selected chart template. `general-business` is broad enough
  to be practical, while `retail`, `services`, and `nonprofit` add focused template-specific accounts.
- Money is stored as integer minor units using PostgreSQL `BIGINT`/Prisma `BigInt`. API responses send
  minor-unit amounts as strings to avoid JavaScript floating-point drift.
- 1G journals are base-currency only. Journal currency must be supported by the currency catalog and
  must match the organization's configured `baseCurrency`.
- Draft journals are editable and deletable. Posted and reversed journals are immutable.
- Posting validates at least two lines, exactly one debit or credit per line, non-zero balanced
  totals, active organization accounts, base currency, and an open fiscal period for the journal date.
- Posting allocates the journal reference through `DocumentNumberingService` inside the same database
  transaction that marks the journal posted and writes audit evidence.
- Reversal creates a new posted journal with debit and credit lines swapped. The original journal is
  marked `REVERSED` and linked to the reversal, but original posted lines remain unchanged.
- Reversal can happen only once and the reversal date must fall in an open fiscal period.
- Authorization remains additive under ADR 0005 with `accounts.*`, `journals.*`, and `reports.view`
  permission keys.

## Consequences

- 1G gives the web app real ledger surfaces without beginning Phase 2 sales, tax, inventory, or
  banking work.
- Multi-currency accounting is intentionally deferred. Future work can extend journal currency,
  exchange-rate, and realized/unrealized gain handling without changing the 1G immutability model.
- Account type and normal-balance changes are blocked after posted history exists, preserving the
  meaning of historical trial-balance calculations.
- Deleting an account archives it instead of hard-deleting, so posted history remains intact.
- Trial balance and account ledger reports are derived from posted/reversed journal lines, not cached
  balances.
- Migration `202608170004_double_entry_ledger` has been written but not applied to PostgreSQL.
- DB-free accounting and helper tests cover the portable invariants; live database tests are still
  needed for tenant/permission HTTP boundaries and true concurrent posting/idempotency behavior.
