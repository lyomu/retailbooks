# ADR 0006: Localization, fiscal periods, and document numbering

- Status: Accepted
- Date: 2026-08-17

## Context

Milestone 1F turns the placeholder country-pack, fiscal-year, and numbering settings from 1D into
real behavior. The product needs Kenya as the first demonstration/default pack, but it must not make
statutory certification claims. Period and numbering data is business-owned data, so every row must
be organization-scoped and reachable only through membership-resolved access.

The API still avoids runtime imports from workspace packages because compiled API code currently
uses shared packages as type-only dependencies. That means portable formatting utilities can live in
`packages/localization`, while API-served reference data remains in an API-local catalog.

## Decision

- `packages/localization` defines the portable country-pack contract, Kenya demonstration pack,
  generic fallback pack, currency minor-unit catalog, and Intl-backed currency/date/time-zone/
  financial-number formatting helpers.
- `apps/api/src/organizations/jurisdiction-catalog.ts` wraps the existing onboarding catalog with
  runtime-safe versioned country-pack metadata. Kenya is marked as `DEMONSTRATION`; unsupported
  country-pack lookups fall back to `GENERIC`.
- Fiscal years and fiscal periods are modeled as first-class organization-owned tables
  (`fiscal_years`, `fiscal_periods`). Periods move through explicit `OPEN`, `CLOSED`, and `LOCKED`
  states.
- Period state changes are narrow service operations: close, lock, unlock, and reopen. Each mutation
  writes a `SecurityEvent` in the same transaction with the actor, previous state, next state, period
  code, and optional note.
- Document numbering uses a separate `document_number_sequences` table keyed by organization,
  document type, and reset scope. This keeps future journals, invoices, credit notes, and other
  documents from sharing one journal-only counter.
- Journal numbering configuration stays reflected in `organization_preferences`, but allocation is
  performed through `DocumentNumberingService` using one PostgreSQL upsert statement that increments
  and returns the allocated value atomically.
- Authorization follows ADR 0005: new permission keys are additive (`periods.*`, `numbering.*`) and
  enforced by `OrganizationGuard` after membership resolution.

## Consequences

- Country packs are software defaults and remain editable per organization; they are not regulatory
  certification.
- Any future organization-owned accounting table must include `organization_id` and should use the
  same resolved organization context.
- Ledger posting in 1G should call `DocumentNumberingService.allocateJournalNumber` inside the same
  transaction that creates the journal, rather than generating identifiers in controller code.
- DB-free boundary and time-zone tests exist, but true concurrent allocation testing still needs a
  live PostgreSQL integration test because only the database can prove the upsert behavior under
  concurrent transactions.
- Migration `202608170003_localization_periods_numbering` has been written but not executed against
  PostgreSQL, matching the previous migration deferral.
