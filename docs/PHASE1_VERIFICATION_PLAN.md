# RetailBooks Phase 1 verification plan

This plan covers the agreed verification pass that milestones 1C–1I each deferred work into.
`docs/PHASE1_TODO.md` remains the progress source of truth; this document explains how the open
boxes get closed and in what order.

## Scope

**Current scope — stages 0 through 8.** Stages 0–3 are complete. Stage 4 closes accounting and tax
correctness before stages 5–8 execute end-to-end journeys, visual and accessibility review,
performance and operational verification, and the final threat-model/readiness record.

## Agreed working decisions

- The DB-backed suite uses a dedicated `retailbooks_test` database on the existing Compose
  PostgreSQL container, rather than Testcontainers — it matches the project's established
  local-infrastructure contract and adds no dependency.
- Correctness defects are fixed inline as found, each in its own commit, separate from the test that
  exposes them. Cosmetic and scope-expanding findings are logged, not fixed.

## Defect register

| #   | Defect                                                                                       | Status                   |
| --- | -------------------------------------------------------------------------------------------- | ------------------------ |
| D1  | SSR hydration mismatch on the design-system route, failing at all three breakpoints          | Open — stage 6, deferred |
| D2  | Reversal journals do not carry a reversed line's tax snapshot forward                        | Resolved — stage 4       |
| D3  | CI had no PostgreSQL service, so no DB-backed test could run in CI                           | Resolved — stage 0       |
| D4  | Checked-in visual baselines are two routes captured before 1C–1I existed                     | Open — stage 6, deferred |
| D5  | `postJournal` idempotency check-then-act is non-atomic                                       | Resolved — stage 4       |
| D6  | Migration SQL had drifted from `schema.prisma` in two ways                                   | Resolved — stage 0       |
| D7  | Two `.env` files (`.env` and `apps/api/.env`) can drift; the API loads whichever matches cwd | Logged, not fixed        |

D5 resolution: posting and reversal now take a transaction-scoped PostgreSQL advisory lock before
the in-transaction idempotency lookup and record. They also lock the target journal row, covering
competing requests that use different keys. Parallel HTTP tests prove same-key requests replay one
result, different-key competitors yield one post and one conflict, and neither path burns a document
number.

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

## Stage 1 — Integration test harness — COMPLETE

The API can now be exercised over HTTP against a real PostgreSQL database. `npm test` remains the
fast, DB-free suite (74 tests, no infrastructure required); `npm run test:integration` is new and
runs specs named `*.int.test.ts`.

**Where the harness lives.** In `apps/api/test/support/`, not `packages/test-utils` as originally
sketched. The harness depends on the API's Nest modules and its generated Prisma client, so hosting
it in a shared package would have inverted the dependency direction. `packages/test-utils` stays for
genuinely shared, dependency-free helpers such as `fixedClock`.

- `database.ts` creates `retailbooks_test` on the existing Compose PostgreSQL if absent, applies
  every migration, and truncates all application tables between tests while preserving
  `_prisma_migrations`. The development database is never touched.
- `app.ts` boots the real `AppModule` through `Test.createTestingModule` and returns a `supertest`
  agent.
- `global-setup.ts` provisions and migrates once per run; `setup-env.ts` points `DATABASE_URL` at the
  test database before any Prisma client is constructed.

**Two things this stage had to fix to work at all:**

1. `bootstrap()` in `main.ts` was neither exported nor separable — it created the app, configured it,
   and listened in one function. Replicating that configuration in the harness would have guaranteed
   drift, so the global prefix, CORS, exception filter, validation pipe, and origin check were
   extracted into `configureApp()` in `src/app-setup.ts`, which `main.ts` and the harness now share.
   A test therefore exercises the same HTTP configuration production serves.
2. Nest resolves constructor dependencies from `emitDecoratorMetadata`, which vitest's default
   esbuild transform does not emit — every injected dependency arrived as `undefined`. The
   integration config runs through `unplugin-swc` instead. The existing DB-free specs never hit this
   because they test pure functions rather than DI-constructed services.

Verified by `test/harness.int.test.ts` (6 tests): the app serves under the production `api/v1`
prefix, the production validation pipe rejects unknown fields, the connection really is
`retailbooks_test`, all six migrations are applied, and truncation clears data while preserving the
schema. CI runs the integration suite against its own PostgreSQL service.

## Stage 2 — Identity and tenancy — COMPLETE

Closes 1C "identity unit and integration tests" and 1D "tenant-isolation integration tests".

- Full HTTP flows: signup, verification, login, logout, forgot-password, reset-password.
- Token expiry and single-use replay for verification and recovery tokens.
- Session rotation on login, revocation on logout, rejection of a revoked session cookie.
- Rate limiting triggers and releases.
- Anti-enumeration: known and unknown emails indistinguishable in response shape.
- Tenant isolation on every organization-scoped route: a member of org A addressing org B's
  identifier receives the same not-found response as a nonexistent identifier.
- Invitation acceptance for a new and an existing user, plus invitation replay rejection.

Verified by `test/identity-tenancy.int.test.ts` (7 tests). The suite uses the real HTTP error
envelope, session cookies, Redis limiter, BullMQ email payloads, and PostgreSQL persistence. The
route-complete tenant-isolation requirement is additionally enforced by Stage 3's endpoint matrix.

## Stage 3 — Authorization boundary — COMPLETE

Closes 1J "cross-tenant and permission-boundary security tests". `permission-resolution.test.ts`
covers the resolution logic, but nothing proves `OrganizationGuard` is mounted on the routes.

- A matrix over all eight organization-scoped system roles against every organization-scoped
  endpoint, asserting allow and deny at the HTTP layer, driven from `permission-catalog.ts` so new
  endpoints cannot escape coverage.
- Privilege escalation: `organization.finalize` and `roles.manage` cannot be granted via a custom
  role override.
- Final-owner protection over HTTP.
- `audit.view` granted to OWNER, ADMIN, ACCOUNTANT, and VIEWER and denied to the four
  module-placeholder roles.

Verified by `test/authorization-boundary.int.test.ts` (6 tests). Controller metadata is compared
against a declared 48-endpoint matrix, including an assertion that every discovered organization
route mounts `OrganizationGuard`. The suite executes 384 role/route decisions, 96 cross-tenant vs
unknown-tenant comparisons, protected-permission escalation attempts, final-owner mutations, and
the explicit audit-view boundary.

## Stage 4 — Accounting and tax invariants — COMPLETE

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

Verified by `test/accounting-invariants.int.test.ts` (7 tests) and the existing time-zone case in
`test/fiscal-periods-calendar.test.ts`. The integration suite sends genuinely parallel HTTP posts,
checks the persisted numbering sequence and idempotency rows, exercises closed/locked/reopened
periods, and proves exact reversal linkage and tax-snapshot preservation after a catalog mutation.
D2 and D5 are resolved in the production ledger service, not masked in the tests.

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
