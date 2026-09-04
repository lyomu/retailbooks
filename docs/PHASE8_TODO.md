# RetailBooks Phase 8 (Globalization) implementation checklist

Durable progress record for Phase 8: Globalization, sequenced by `docs/EXECUTION_PLAN.md`
Stage 6. This phase turns on decision D3 (country-pack DB model).
`docs/BUILD_ROADMAP.md`'s Phase 8 section is the rolled-up summary and is synced at close-out,
in the same commit, per the convention in `HANDOVER.md` §3.

## Decisions carried in

**D3 — Country packs: static catalog → DB model, decided 2026-09-02** (`EXECUTION_PLAN.md`).
`jurisdiction-catalog.ts` stays the seed source and fresh-database fallback; `CountryPack` becomes a
versioned, publishable DB entity; readers move to the DB (`CountryPackStore`). The Kenya pack keeps
its explicit _demonstration_ labelling through the migration — seeding must never launder an unreviewed
pack into an implied compliance claim (the seed path is tier-locked to TIER_B_GENERIC and never touches
status/tier).

Two consequences of D3 that shaped the implementation:

1. **Seeding is tier-locked.** The `CountryPackStore.seed()` upsert deliberately omits `status` and
   `tier` from its update branch, so re-running the seed can never resurrect a deprecated pack or
   downgrade a tier a reviewer raised. Those change only through Phase 12's admin path.
2. **Compliance is derived, never stored.** A stored flag would go stale the moment a pack's tier
   changed underneath it. `resolveCompliance` recomputes from the pinned pack at read time: Tier A
   *published* → FULLY_REVIEWED, Tier B → GENERIC_CONFIGURATION, Tier C/unknown → UNSUPPORTED. A
   deprecated Tier A pack stops carrying compliance claims immediately.

## Milestone 8A — Schema and migration

- [x] `CountryPack` as a versioned, publishable DB entity (unique `(code, version)`, status
      DRAFT/PUBLISHED/DEPRECATED, tier TIER_A_REVIEWED/TIER_B_GENERIC/TIER_C_BLOCKED, JSONB
      defaults/notes/supportedEntityTypes) — seeded from `jurisdiction-catalog.ts` per D3
- [x] `TaxPack` versioned under each pack (rates, registration fields, exemptions, reporting mappings)
- [x] `DocumentRule` per pack + document type (legal fields, numbering constraints, labels, footer text)
- [x] `StructuredInvoice` — canonical JSON data artifact stored separately from the PDF-render
      `DocumentSnapshot`, with its own `payloadSchemaVersion`
- [x] Migration `20260903140000_add_phase8_globalization` written via the documented shadow-db
      `migrate diff` dance, applied, and drift-checked empty

## Milestone 8B — Backend

- [x] Country-pack CRUD + version/publish/deprecate behind a `PlatformAdminGuard` (interim
      `PLATFORM_ADMIN_EMAILS` allowlist until Phase 12's superadmin auth); one-way DRAFT→PUBLISHED→DEPRECATED
      lifecycle; published packs read-only, deprecated packs never re-published (version is the fix)
- [x] Tier A/B/C enforcement on compliance-sensitive TAX setup (tax-registered or identifier):
      rejected with 400 for Tier C/unknown packs — never imply compliance where unreviewed
- [x] Per-organization compliance status derived at read time from the pinned pack (`CountryPackStore.resolveCompliance`);
      surfaced as `compliance` on every org detail response via `packages/contracts`
- [x] Locale/i18n string catalog in `packages/localization` (`enStrings` base bundle + `resolveStrings`
      with honest base-bundle fallback); org settings render compliance badges and a language-fallback note
- [x] Finalized transactions freeze the active country pack version at issue time (`issueInvoice`/`issueBill`
      write `countryPackCodeSnapshot`/`countryPackVersionSnapshot` once inside the issue transaction);
      the structured-invoice artifact is also persisted in the same transaction

## Milestone 8C — UI

- [x] Compliance-status badge + pinned-pack block in organization settings (between Jurisdiction and Accounting)
- [x] Language-fallback note in the locale switcher (surfaces `settings.language.fallback` when `fallbackUsed`)

## Milestone 8D — Tests

- [x] Structured invoice round-trips and stays independent of PDF rendering (`invoices.int.test.ts`:
      canonical artifact at issue time, no render step required, schema version pinned, payload carries
      the frozen pack/version/totals/lines; the PDF `DocumentSnapshot` table is NOT written by issue)
- [x] Unsupported-jurisdiction compliance claims never render (`country-packs.int.test.ts`: TAX setup
      blocked with 400 for an unknown pack, org detail surfaces UNSUPPORTED with no fabricated pack name)
- [x] Country-pack version pinned at issue does not change when the pack is later edited
      (`invoices.int.test.ts` pin test + `country-packs.int.test.ts` acceptance test)

`apps/api/test/country-packs.int.test.ts` (5 tests), `apps/api/test/invoices.int.test.ts` (8 tests,
including the new structured-invoice round-trip and pin tests).

## Milestone 8E — Close-out

- [x] `docs/BUILD_ROADMAP.md` Phase 8 section rolled up **in the same commit**
- [x] `docs/HANDOVER.md` refreshed — Phase 8 moved to "complete and verified", next-up pointer advanced to Phase 9
- [x] Full CI sequence green: lint (0 warnings), format-check, workspace-wide typecheck, unit suite,
      integration suites (catalog, invoices incl. new pin + structured-invoice tests, bills, country-packs,
      identity-tenancy, authorization-boundary)

## Verification run so far

- `lint` clean (0 errors, 0 warnings)
- `format:check` clean
- `typecheck` clean across the workspace (api, web, packages)
- Unit suite: localization (12), country-pack seed (5), i18n helper (6), plus the pre-existing unit suites
- Integration: `invoices.int.test.ts` (8), `country-packs.int.test.ts` (5), `catalog.int.test.ts`,
  `bills.int.test.ts`, `identity-tenancy.int.test.ts` (7), `authorization-boundary.int.test.ts` (6) — all pass
- Working tree clean on `chore/verification-closure`

## Two real bugs the Phase 8 work surfaced

1. **`CountryPackStore.seedPromise` cached forever.** A table truncation in a later test reused a stale
   "already seeded" resolved promise and never re-seeded. Fixed: the cached promise is cleared when it
   settles (success or failure), so a later truncation-and-reset still triggers a fresh seed.
2. **API compliance field key diverged from contracts schema.** The store emitted `complianceStatus`
   but `packages/contracts` declared `status` on `OrganizationDetail.compliance`. The store now emits
   `status`, matching the schema the web consumes.

