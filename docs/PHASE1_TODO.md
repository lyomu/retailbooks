# RetailBooks Phase 1 implementation checklist

This is the durable progress record for the accepted Phase 1 plan. An item is checked only after
its implementation has been verified. Detailed acceptance evidence should be added to the relevant
pull request, commit, or milestone note.

## Milestone 0 — Authority and project record

- [x] Record product purpose, users, boundaries, and source precedence in `PRODUCT.md`
- [x] Record the RetailFlow-derived visual contract in seed `DESIGN.md`
- [x] Establish this Phase 1 checklist as the progress source of truth
- [x] Re-scan the implemented interface and replace seed design documentation with code-derived
      tokens and component evidence

## Milestone 1A — Workspace and portable local infrastructure

- [x] Initialize the Git repository on `main`
- [x] Create npm workspaces for web, API, and shared packages
- [x] Establish TypeScript, ESLint, Prettier, and environment conventions
- [x] Add Next.js web and NestJS API application skeletons
- [x] Add shared UI, contracts, accounting-core, localization, configuration, and test packages
- [x] Add PostgreSQL, Redis, MinIO, and Mailpit through Docker Compose
- [x] Add health endpoints and local dependency health checks
- [x] Add GitHub Actions for formatting, lint, typecheck, tests, and builds
- [x] Verify clean install, formatting, lint, typecheck, unit tests, production builds, and Compose
      configuration
- [x] Create the verified Milestone 1A baseline commit

## Milestone 1B — RetailFlow design foundation

- [x] Implement exact color, spacing, radius, typography, elevation, and motion tokens
- [x] Add the provisional RetailBooks book/ledger mark
- [x] Implement responsive application shell: sidebar, top bar, page container, and mobile drawer
- [x] Implement accessible buttons, inputs, selects, cards, tabs, badges, tables, dialogs, drawers,
      toasts, loaders, error states, and empty states
- [x] Add Storybook or an equivalent component-development surface
- [x] Build design-system reference pages for density and responsive behavior
- [x] Add component accessibility tests
- [ ] Capture initial visual-regression baselines against supplied RetailFlow references

## Milestone 1C — Identity and sessions

- [x] Model users, password credentials, email verification, sessions, and recovery tokens
- [x] Implement signup, verification, login, logout, forgot-password, and reset-password flows
- [x] Use secure password hashing, rotating/revocable sessions, rate limiting, and anti-enumeration
      responses
- [x] Add transactional email templates and Mailpit-backed local delivery
- [x] Add session/device management settings
- [x] Represent MFA as a disabled future capability without implying functionality
- [x] Add identity unit and integration tests, including token expiry and replay cases — proven by
      `apps/api/test/identity-tenancy.int.test.ts`

Implementation note: API and web TypeScript compilation passed on 2026-08-16. Database migration
execution, Mailpit delivery verification, browser QA, and automated identity tests are intentionally
deferred to the agreed verification pass.

## Milestone 1D — Organizations and onboarding

- [x] Model organizations, memberships, invitations, and organization-scoped preferences
- [x] Implement organization creation and switching
- [x] Implement self-service onboarding after email verification
- [x] Collect legal/display name, country, base currency, time zone, fiscal start, and language
- [x] Support invitation acceptance for existing and new users
- [x] Enforce organization scoping in persistence and service boundaries
- [x] Add tenant-isolation integration tests — representative flows are proven by
      `identity-tenancy.int.test.ts`; every organization-scoped route is proven by
      `authorization-boundary.int.test.ts`

Implementation note: API, web, contracts, and UI TypeScript compilation passed on 2026-08-17.
Organization access is resolved only from the authenticated user's membership through
`OrganizationAccessService`/`OrganizationGuard`, and non-members receive the same not-found response
as unknown identifiers. Organization creation and onboarding finalization are each single
transactions. Design decisions are recorded in `docs/adr/0004-organization-tenancy-and-onboarding.md`.

The following remain deliberately unverified and are carried into the agreed verification pass:
migration `202608170001_organizations_and_onboarding` has not been executed against PostgreSQL,
invitation email delivery has not been checked in Mailpit, the onboarding and team surfaces have not
had browser or visual-regression QA, and no automated tenant-isolation, invitation-replay, or
onboarding tests exist yet.

## Milestone 1E — Roles, permissions, and audit authorization

- [x] Define the eight organization-scoped system role baselines
- [x] Implement organization-scoped custom role overrides
- [x] Enforce authorization centrally in the API and reflect it safely in the UI
- [x] Prevent removal of the final owner and unsafe privilege escalation
- [x] Audit membership, invitation, and role changes
- [x] Add permission matrix and negative authorization tests

Implementation note: API, web, contracts, and UI TypeScript compilation passed on 2026-08-17.
`OrganizationAccessService.requireMembership` now resolves an effective permission set alongside
role, and `OrganizationGuard` enforces `@RequirePermission(key)` in place of the 1D role allowlist,
which has been removed with no parallel mechanism left (confirmed by grep). OWNER's permission set is
total and immutable; `organization.finalize` and `roles.manage` are protected keys with no override
grant path, which is the entire privilege-escalation defence. Member role changes and removals reject
OWNER as a target by construction, so an organization can never lock out its own owner. Every member
role/status change, member removal, and role-permission override writes a `SecurityEvent` in the same
transaction as the mutation. Design decisions are recorded in
`docs/adr/0005-authorization-and-permission-overrides.md`.

Permission-resolution and owner-protection logic is covered by DB-free unit tests
(`apps/api/test/permission-resolution.test.ts`, 14 tests), which pass, alongside the existing
`packages/accounting-core`, `packages/localization`, and `packages/ui` suites (no regressions). The
following remain deliberately unverified and are carried into the agreed verification pass: migration
`202608170002_roles_and_permissions` has not been executed against PostgreSQL, the Roles & permissions
UI has not had browser or visual-regression QA, and no automated cross-tenant or HTTP-level
negative-authorization integration tests exist yet.

## Milestone 1F — Localization, periods, and numbering

- [x] Define versioned country-pack contracts and fallback behavior
- [x] Implement Kenya as the demonstration/default pack without certification claims
- [x] Implement currency, date, time-zone, locale, and financial-number formatting
- [x] Model fiscal years and periods with open, closed, and locked states
- [x] Implement controlled period close/reopen/lock operations with audit evidence
- [x] Implement configurable, concurrency-safe document numbering
- [x] Add boundary, concurrency, and time-zone tests — proven by
      `fiscal-periods-calendar.test.ts` and `accounting-invariants.int.test.ts`

Implementation note: API, web, contracts, and localization TypeScript compilation passed on
2026-08-17. DB-free tests passed for localization formatting and country-pack fallback
(`packages/localization`, 7 tests) and for fiscal calendar/document-numbering logic plus the
existing API suite (`apps/api`, 21 total tests). Fiscal years, fiscal periods, and document-number
sequences are organization-scoped and exposed only through `OrganizationGuard` plus additive
permission keys. Period close, lock, reopen, unlock, fiscal-year generation, and numbering
configuration write `SecurityEvent` evidence in the same transaction as the mutation. Journal
numbering allocation is implemented as an atomic PostgreSQL upsert for future ledger posting.

The following remain deliberately unverified and are carried into the agreed verification pass:
migration `202608170003_localization_periods_numbering` has not been executed against PostgreSQL,
HTTP-level period/numbering authorization tests have not been run, and true concurrent allocation
testing against live PostgreSQL is still deferred because the DB-free suite cannot prove database
transaction behavior.

## Milestone 1G — Double-entry ledger

- [x] Model chart of accounts, journals, journal lines, posting references, and reversals
- [x] Seed an editable starter chart of accounts through country-pack defaults
- [x] Keep drafts editable while making posted journals immutable
- [x] Enforce balanced debits/credits, valid accounts, supported currencies, and open periods
- [x] Implement posting and explicit reversal as atomic transactions
- [x] Preserve source linkage and append-only audit evidence
- [x] Add trial balance, account ledger, and journal inquiry queries
- [x] Add accounting invariant, idempotency, concurrency, and reversal tests — proven by
      `apps/api/test/accounting-invariants.int.test.ts`

Implementation note: API, web, contracts, and accounting-core TypeScript compilation passed on
2026-08-17. DB-free tests passed for accounting-core ledger invariants and the API helper suite,
including starter-chart generation and ledger permission defaults. The 1G ledger is organization
scoped end-to-end, uses `OrganizationGuard` plus additive permission keys, stores all money as
integer minor-unit `BigInt` values, allocates posted journal references through the 1F
`DocumentNumberingService`, and records posting/reversal audit evidence in the same transaction as
the ledger mutation. The first RetailFlow-style ledger UI routes now exist for chart of accounts,
journals, journal entry/review, trial balance, and account-ledger inquiry. Design decisions are
recorded in `docs/adr/0007-double-entry-ledger.md`.

The following remain deliberately unverified and are carried into the agreed verification pass:
migration `202608170004_double_entry_ledger` has not been executed against PostgreSQL, HTTP-level
tenant/permission integration tests have not been run, true concurrent posting/idempotency checks
against PostgreSQL remain deferred, and browser/visual QA for the new ledger screens remains
deferred. The test item remains open because the DB-free suite cannot prove database transaction
isolation or HTTP boundary behavior.

## Milestone 1H — Tax engine foundation

- [x] Model tax codes, effective-dated rates, recoverability, inclusivity, and account mappings
- [x] Implement deterministic inclusive and exclusive tax calculations
- [x] Define rounding and residual-allocation rules
- [x] Supply Kenya defaults through the country pack as configurable reference data
- [x] Record tax snapshots on posted accounting lines
- [x] Add tax calculation and effective-date test matrices

Implementation note: API, web, contracts, and accounting-core TypeScript compilation passed on
2026-08-17. DB-free tests passed for the new BigInt-only rounding/inclusive/exclusive calculation
matrix (`packages/accounting-core`), the Kenya/generic starter tax-code catalog, and the effective-date
resolution/overlap matrix (`apps/api/test/tax-code-catalog.test.ts`,
`apps/api/test/tax-rate-resolution.test.ts`), alongside the existing full suite (no regressions,
`permission-resolution.test.ts` unmodified). Tax codes (`tax_codes`) and effective-dated rates
(`tax_rates`) are new organization-scoped tables, lazily seeded from the country pack the same way the
1G starter chart of accounts is seeded, and reachable only through `OrganizationGuard` plus the new
additive `tax.codes.view`/`tax.codes.manage` permission keys. Kenya seeds `VAT-STD` (16%, exclusive,
recoverable), `VAT-ZERO` (0%, exclusive, recoverable), and `VAT-EXEMPT` (0%, exclusive,
non-recoverable); other jurisdictions seed a single non-recoverable `NO-TAX` placeholder. All tax
math is BigInt-only integer arithmetic in `packages/accounting-core` (round-half-up division, with the
tax component treated as a residual in inclusive mode so base + tax always reconstructs the original
total exactly) — no floating point touches tax amounts, matching the existing ledger-money convention.
`JournalLine` gained a live, draft-editable `taxCodeId` plus six snapshot columns
(`taxCodeSnapshot`, `taxTreatmentSnapshot`, `taxRecoverableSnapshot`, `taxRatePercentSnapshot`,
`taxableAmountMinor`, `taxAmountMinor`) that `LedgerService.postJournal` freezes inside its existing
posting transaction, immediately after journal-number allocation, so a later edit to the tax catalog
can never drift an already-posted line. A `POST .../tax/calculate` endpoint gives a stateless preview
for both draft-time UI and ad hoc "what would this tax be" checks. The web app ships a working `/tax`
surface (tax-code list, effective-dated rate history, and a calculation preview) and a tax-code
selector with live computed-tax preview in the journal-line grid, following the 1G ledger UI's
precedent of shipping a real surface in the same milestone rather than deferring it to 1I. Design
decisions are recorded in `docs/adr/0008-tax-engine-foundation.md`.

The following remain deliberately unverified and are carried into the agreed verification pass:
migration `202608180001_tax_engine_foundation` has been written but not executed against PostgreSQL,
HTTP-level tenant/permission integration tests have not been run, reversal journals do not currently
carry forward a reversed line's tax snapshot (reversal was already out of this milestone's explicit
scope), and browser/visual QA for the new tax screens remains deferred.

## Milestone 1I — Phase 1 product surfaces

- [x] Implement an accounting dashboard with meaningful drill-downs and honest empty states
- [x] Implement chart-of-accounts management
- [x] Implement journal list, journal creation, review, posting, and reversal surfaces
- [x] Implement trial balance and account-ledger inquiry surfaces
- [x] Implement organization, fiscal period, numbering, localization, and tax settings
- [x] Implement team, roles, invitations, sessions, and audit-log surfaces
- [x] Match RetailFlow density, shell geometry, responsive behavior, and state treatment
- [x] Add route-level loading, error, forbidden, not-found, and empty states

Implementation note: API, web, contracts, and accounting-core TypeScript compilation passed on
2026-08-17. Chart-of-accounts, journal, trial-balance, account-ledger, tax-code, team/roles/
invitations, and session surfaces were already implemented in 1D–1H; this milestone closed the six
gaps that remained: organization profile/jurisdiction/accounting/tax-defaults settings
(`/settings/organization`), fiscal-period settings (`/periods`), document-numbering settings
(`/numbering`), an audit log (`/settings/audit-log`, built from scratch — backend and frontend both
new), a real data-driven dashboard (`apps/web/src/components/dashboard.tsx`, previously 100%
hardcoded placeholder), and root-level Next.js `loading.tsx`/`error.tsx`/`global-error.tsx`/
`not-found.tsx`. The audit log is the only genuinely new backend surface: a new `AuditLogService`/
`AuditLogController` pair reads the existing `SecurityEvent` table (written by 28 event keys across
every prior milestone, previously never read back) through a new `audit.view` permission (granted to
OWNER/ADMIN/ACCOUNTANT/VIEWER by default, not the four module-placeholder roles) and a
keyset-cursor-paginated endpoint — the API's first
real pagination pattern, chosen because the table is append-only and unbounded and the existing
`[organizationId, occurredAt]` index supports keyset paging in O(limit) regardless of depth. The
organization-profile page submits one `PATCH /organizations/:id` per section
(`PROFILE`/`JURISDICTION`/`ACCOUNTING`/`TAX`), matching how the endpoint has always been section-
scoped since 1D. The numbering page calls the dedicated `numbering.manage` endpoint rather than the
organization-update `NUMBERING` section, since only the dedicated endpoint keeps the live document-
number sequence row in sync. The dashboard now composes real KPIs (active accounts, posted/draft
journal counts, trial-balance balanced status, current open fiscal period) and a posted-journal-
volume-by-month chart from existing endpoints client-side — no new dashboard-specific backend route —
and deliberately drops the previous hardcoded currency stat cards and fake cashflow chart rather than
approximate them, since there is no "cash account" concept anywhere in the schema to compute them
honestly. A new shared `ForbiddenState` component (`packages/ui`) covers the one page whose minimum
view permission isn't universal (the audit log); every other settings page keeps the existing
hide-the-control-not-the-page pattern, since their view permissions remain granted to every role.
Design decisions are recorded in `docs/adr/0009-phase1-product-surfaces.md`.

The following remain deliberately unverified and are carried into the agreed verification pass:
HTTP-level tenant/permission integration tests for the new audit-log endpoint have not been run, and
browser/visual QA for the new settings/dashboard screens remains deferred. No migration was needed
this milestone — the audit log reads the existing `SecurityEvent` table without schema changes.

## Verification pass — progress

The verification pass that milestones 1C–1I each deferred work into is planned in
`docs/PHASE1_VERIFICATION_PLAN.md`, scoped to stages 0–5 (schema, integration harness, identity and
tenancy, authorization, accounting and tax invariants, end-to-end journeys). Stages 6–8 are deliberately
deferred and reassessed once those land.

**Stage 0 — schema proven (2026-08-24).** All six migrations
(`202608160001` through `202608180001`) were applied to PostgreSQL for the first time and applied
cleanly. This supersedes the "migration has not been executed against PostgreSQL" caveat recorded in
the 1C, 1D, 1E, 1F, 1G, and 1H implementation notes above.

The drift check found and fixed a real divergence between the migration SQL and `schema.prisma`:
fourteen `updated_at` columns carry a `DEFAULT CURRENT_TIMESTAMP` the datamodel did not declare — a
load-bearing default, since `DocumentNumberingService.allocateJournalNumberWithClient` inserts
without supplying `updated_at` — and three index names differed, one of them because PostgreSQL
silently truncated a 69-character identifier to its 63-byte limit. `schema.prisma` was corrected to
describe the deployed database rather than issuing DDL against it.

`prisma migrate diff` now reports no difference in both directions: live database against datamodel,
and the migration files replayed from scratch into a shadow database against datamodel. The API
boots on freshly built code with postgres, redis, and minio all reporting up. A `services: postgres`
block and the shadow-database drift check are wired into `.github/workflows/ci.yml`.

**Stage 1 — integration harness (2026-08-24).** The API can now be exercised over HTTP against a
real database. `npm test` remains the fast DB-free suite (74 tests, no infrastructure needed) and
`npm run test:integration` is new, running `*.int.test.ts` specs against a dedicated
`retailbooks_test` database that is created, migrated, and truncated automatically. The harness
lives in `apps/api/test/support/` rather than `packages/test-utils`, because it depends on the API's
Nest modules and generated Prisma client.

Two blockers were fixed to make this possible. The global HTTP configuration was extracted from
`main.ts` into `configureApp()` in `src/app-setup.ts`, shared by the production bootstrap and the
harness, so tests exercise the same prefix, validation, error shaping, and origin rules production
serves. The integration suite also runs through `unplugin-swc`, because Nest resolves constructor
dependencies from `emitDecoratorMetadata`, which vitest's default esbuild transform does not emit.

Proven by `apps/api/test/harness.int.test.ts` (6 tests). This is infrastructure only — no milestone
checkbox closes here; stages 2–4 consume it.

**Stage 2 — identity and tenancy (2026-08-24).** Seven production-shaped HTTP integration tests now
cover signup, single-use verification, login/logout, session rotation and revocation, expired
verification and recovery tokens, password-reset replay, anti-enumeration, Redis rate limiting and
release, tenant-indistinguishable not-found responses, and invitation acceptance for existing and
new users. Test email jobs use an isolated BullMQ prefix so acceptance traffic cannot contaminate
development queue health.

**Stage 3 — authorization boundary (2026-08-24).** A controller-metadata contract discovers all 48
organization-scoped endpoints and fails when an endpoint lacks `OrganizationGuard` or a matrix
entry. The HTTP suite exercises all eight system roles across every endpoint (384 decisions), then
proves all 48 routes return identical not-found envelopes for another tenant and a nonexistent
tenant (96 comparisons). Protected-permission escalation, final-owner protection, and the exact
four-role `audit.view` boundary are also proven over HTTP.

**Stage 4 — accounting and tax invariants (2026-08-24).** Seven PostgreSQL-backed tests prove
unbalanced-entry rejection, the period transition and posting boundary, gap-free numbering under
parallel posting, atomic same-key replay, safe competing posts with different keys, posted-record
immutability, equal trial-balance totals, frozen tax snapshots, and exact linked reversal. D2 was
fixed by copying every tax snapshot field to reversal lines. D5 was fixed with transaction-scoped
idempotency locks plus journal row locks, so concurrent requests neither double-post nor burn a
document number. Time-zone fiscal-boundary behavior remains proven by
`fiscal-periods-calendar.test.ts`.

**Stage 5 — end-to-end journeys (2026-08-24).** Six serial Playwright journeys run against a
production-mode build and a dedicated `retailbooks_e2e` database (provisioned, migrated, truncated, and
reseeded via `apps/web/e2e/prepare.mjs` on every run) cover identity (anti-enumerating password reset,
login, logout), onboarding (the full wizard through to a switchable new organization), teams (invite
send and withdraw), periods (close and reopen), journals (draft, post, reverse, with the immutability
notice), and tax (code, rate, and calculation preview). Getting this green surfaced two real defects
beyond selector drift: `NEXT_PUBLIC_API_URL` is inlined into the Next.js bundle at build time, so the
web `webServer` entry now runs a build before `next start` with the e2e API URL in its environment
(`apps/web/playwright.config.ts`); and `LedgerService`'s reversal and first-draft-save flows navigated
to a new journal route immediately after setting a local toast notice, which unmounted the notice before
it ever rendered — fixed by carrying the notice across the navigation via a short-lived
`sessionStorage` flash key (`apps/web/src/components/ledger-workbench.tsx`). `apps/web/e2e/prepare.mjs`
also now clears Redis-backed auth rate-limit keys on every run so repeated local iteration doesn't trip
false 429s.

## Milestone 1J — Hardening and Phase 1 acceptance

- [x] Complete end-to-end journeys for identity, onboarding, teams, periods, journals, and tax —
      verification stage 5, proven by `apps/web/e2e/phase1-journeys.spec.ts`
- [x] Complete cross-tenant and permission-boundary security tests — verification stages 2–3,
      proven by `identity-tenancy.int.test.ts` and `authorization-boundary.int.test.ts`
- [ ] Complete visual regression at desktop, tablet, and mobile breakpoints — verification stage 6,
      deferred and blocked on D1
- [ ] Complete WCAG 2.2 AA keyboard, screen-reader, contrast, and focus review — verification stage 6,
      deferred
- [ ] Complete performance budgets and query/index review — verification stage 7, deferred
- [ ] Complete audit-log coverage and immutable-posting review — audit events partly delivered by
      foundation step 3; invariant verification remains deferred to stage 4
- [ ] Complete backup/restore, migration, seed, and operational runbooks — service-driven demo seed
      delivered by foundation step 7; backup/restore and runbooks remain deferred
- [ ] Complete threat model, dependency review, secret handling, and production-readiness checklist —
      verification stages 7–8, deferred
- [ ] Update `DESIGN.md` from the implemented system and close all Phase 1 acceptance gaps —
      verification stage 8, deferred
- [x] Add structured observability, request correlation, redaction, and an error-reporting seam —
      foundation step 1
- [x] Add Redis/BullMQ job infrastructure with a separate worker, retries, retained failed jobs, and
      queue health — foundation step 6

## Deferred beyond Phase 1

- Inventory and cost accounting
- Banking feeds and reconciliation automation
- Payment gateway integrations are excluded from all of V1, not merely deferred beyond Phase 1;
  revisit them only in post-V1 planning
- Payroll, fixed assets, budgeting, consolidation, and advanced reporting
- Functional MFA
- Native mobile applications
- Full marketing website
- Production hosting and jurisdictional certification
