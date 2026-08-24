# RetailBooks Phase 1 verification plan

This plan covers the agreed verification pass that milestones 1C–1I each deferred work into.
`docs/PHASE1_TODO.md` remains the progress source of truth; this document explains how the open
boxes get closed and in what order.

## Scope

**In scope — stages 0 through 4.** Prove the schema, build the missing integration harness, then
close the identity, tenancy, authorization, and accounting/tax correctness gaps.

**Deliberately deferred — stages 5 through 8.** End-to-end journeys, visual regression, WCAG 2.2 AA
review, performance budgets, runbooks, and the threat model. These are reassessed once stages 0–4
land, because they would churn if the earlier stages force schema changes.

## Agreed working decisions

- The DB-backed suite uses a dedicated `retailbooks_test` database on the existing Compose
  PostgreSQL container, rather than Testcontainers — it matches the project's established
  local-infrastructure contract and adds no dependency.
- Correctness defects are fixed inline as found, each in its own commit, separate from the test that
  exposes them. Cosmetic and scope-expanding findings are logged, not fixed.

## Defect register

| #   | Defect                                                                                       | Status                        |
| --- | -------------------------------------------------------------------------------------------- | ----------------------------- |
| D1  | SSR hydration mismatch on the design-system route, failing at all three breakpoints          | Open — stage 6, deferred      |
| D2  | Reversal journals do not carry a reversed line's tax snapshot forward                        | Open — stage 4                |
| D3  | CI had no PostgreSQL service, so no DB-backed test could run in CI                           | Resolved — stage 0            |
| D4  | Checked-in visual baselines are two routes captured before 1C–1I existed                     | Open — stage 6, deferred      |
| D5  | `postJournal` idempotency check-then-act is non-atomic                                       | Predicted — stage 4 proves it |
| D6  | Migration SQL had drifted from `schema.prisma` in two ways                                   | Resolved — stage 0            |
| D7  | Two `.env` files (`.env` and `apps/api/.env`) can drift; the API loads whichever matches cwd | Logged, not fixed             |

D5 detail: `findIdempotentResult` queries via `this.prisma`, outside the transaction, while
`recordIdempotency` inserts inside it against the `@@unique([organizationId, operation, key])`
constraint. Two concurrent posts sharing a key should both pass the pre-check, both allocate a
journal number, and the loser should fail on the constraint rather than replaying the winner's
result — burning a document number. Stage 4 proves or disproves this before any fix.

## Stage 0 — Prove the schema — COMPLETE

All six migrations applied cleanly to PostgreSQL on first execution, against a previously empty
database. `prisma migrate status` now reports all six applied.

The drift check then found real divergence (D6), in two classes:

1. **`updated_at` defaults, 14 tables.** The migration SQL creates every `updated_at` column as
   `TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP`, but `schema.prisma` declared a bare
   `@updatedAt` with no default. This default is load-bearing: the raw `INSERT ... ON CONFLICT` in
   `DocumentNumberingService.allocateJournalNumberWithClient` never supplies `updated_at`, so
   regenerating migrations from the old datamodel would have dropped the default and broken every
   journal-number allocation with a NOT NULL violation.

2. **Three index names.** `document_number_sequences_org_type_scope_key` and
   `organization_role_permissions_org_role_key_key` were hand-shortened in the migration SQL. The
   third is a PostgreSQL artifact: the migration asked for
   `ledger_idempotency_keys_organization_id_resource_type_resource_id_idx` (69 characters) and
   PostgreSQL silently truncated it to the 63-byte identifier limit.

Both classes were resolved by making `schema.prisma` describe the deployed database — adding
`@default(now())` to the 14 `updatedAt` fields and pinning the three names with `map:` — rather than
issuing DDL against a database that is already correct and whose behaviour the services depend on.

Verified: `prisma migrate diff` reports no difference in both directions — live database against
datamodel, and migration files replayed from scratch into a shadow database against datamodel. The
API boots on freshly built code with `postgres`, `redis`, and `minio` all reporting up.

A `services: postgres` block and the shadow-database drift check are now wired into
`.github/workflows/ci.yml`, which also resolves D3 ahead of stage 1.

## Stage 1 — Integration test harness

`packages/test-utils` currently exports one function, `fixedClock`. This stage builds the capability
to write a DB-backed test at all, and is the prerequisite for stages 2–4.

- Database lifecycle: `retailbooks_test` on the existing Compose PostgreSQL, migrated once per run,
  truncated between tests.
- App bootstrap: `Test.createTestingModule` against `apps/api/src/app.module.ts` wrapped with
  `supertest`, yielding an authenticated HTTP client for a given user and role. Session auth is
  cookie-based — reuse `apps/api/src/auth/session-cookie.ts` rather than reimplementing it.
- Fixture factories: verified user, organization with a membership at a chosen role, ledger accounts,
  draft and posted journals, tax codes. Seed through the real services where practical so fixtures
  cannot drift from production paths.
- Add `apps/api/vitest.config.ts` separating the DB-free suite from the integration suite. `npm test`
  stays fast and DB-free; `npm run test:integration` is new.

## Stage 2 — Identity and tenancy

Closes 1C "identity unit and integration tests" and 1D "tenant-isolation integration tests".

- Full HTTP flows: signup, verification, login, logout, forgot-password, reset-password.
- Token expiry and single-use replay for verification and recovery tokens.
- Session rotation on login, revocation on logout, rejection of a revoked session cookie.
- Rate limiting triggers and releases.
- Anti-enumeration: known and unknown emails indistinguishable in response shape.
- Tenant isolation on every organization-scoped route: a member of org A addressing org B's
  identifier receives the same not-found response as a nonexistent identifier.
- Invitation acceptance for a new and an existing user, plus invitation replay rejection.

## Stage 3 — Authorization boundary

Closes 1J "cross-tenant and permission-boundary security tests". `permission-resolution.test.ts`
covers the resolution logic, but nothing proves `OrganizationGuard` is mounted on the routes.

- A matrix over the four baseline roles against every organization-scoped endpoint, asserting allow
  and deny at the HTTP layer, driven from `permission-catalog.ts` so new endpoints cannot escape
  coverage.
- Privilege escalation: `organization.finalize` and `roles.manage` cannot be granted via a custom
  role override.
- Final-owner protection over HTTP.
- `audit.view` denied to STAFF, granted to the other three roles.

## Stage 4 — Accounting and tax invariants

Closes 1F "boundary, concurrency, and time-zone tests" and 1G "accounting invariant, idempotency,
concurrency, and reversal tests". Resolves D2 and settles D5.

- Numbering concurrency: N parallel allocations produce no duplicates and no gaps.
- Period boundaries resolved against the organization's time zone, not the server's.
- Period state machine, including rejection of posting into a closed or locked period.
- Ledger invariants: unbalanced entries rejected, posted journals immutable, trial balance sums to
  zero.
- Idempotency: a replayed key does not double-post.
- Posting concurrency corrupts neither numbering nor balances.
- Reversal reverses exactly, links to source, is immutable, and carries the tax snapshot forward.
- Tax snapshots: mutating the catalog after posting leaves posted lines unchanged.

## Verification gate

Every stage ends green on:

```
npm run format:check
npm run lint
npm run typecheck
npm test                  # DB-free, currently 74 tests
npm run test:integration  # new from stage 1
npm run build
```

Concurrency claims are demonstrated with genuinely parallel requests, not sequential ones. Each
closed checkbox in `docs/PHASE1_TODO.md` names the specific test that proves it.
