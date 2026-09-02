# Handover Prompt — RetailBooks Global Accounting Platform

**Project:** `c:\Users\gmnyo\Desktop\Engineering projects\retailbooks` — a multi-tenant, global,
double-entry accounting & invoicing web platform (monorepo: `apps/api` NestJS, `apps/web` Next.js,
`packages/*` shared libs).

**Last refreshed:** 2026-09-02.

## 1. Where things stand

Six of fourteen phases have code. **Three** meet the roadmap's own "done and verified" bar.

| Phase                      | State                                                          |
| -------------------------- | -------------------------------------------------------------- |
| 1 Foundation               | Functionally complete; hardening/test debt open (Milestone 1J) |
| 2 Sales                    | Complete and verified (2A–2K)                                  |
| 3 Purchases                | Complete and verified (3A–3H)                                  |
| 4 Accounting Engine        | Complete and verified (4A–4G)                                  |
| 5 Banking & Reconciliation | **Built, not verified — no tests exist at all**                |
| 6 Inventory                | Built, with inventory integration coverage                     |
| 7–14                       | No code                                                        |

**The active plan is `docs/EXECUTION_PLAN.md`.** It sequences the remaining verification debt
(Stages 0–4) and Phases 7–9 (Stages 5–7), and records three decisions (D1 ledger dimensions,
D2 report query strategy, D3 country-pack DB model) that must be made before Phase 7 starts.
Read it before picking up work.

### What is genuinely open, in priority order

1. **Phase 5 has zero test coverage** (Stage 2 of the execution plan). All of `apps/api/src/banking/`
   — statement import with CSV parsing and sha256 fingerprint dedup, bank rules with a pure
   condition-matching engine, transaction categorize/split/exclude/match/unmatch, cross-currency
   transfers, and reconciliation with a zero-tolerance completion gate — shipped in `ae8ae3e` under
   an explicit user-confirmed "code first, tests later" rule. That rule was never lifted. There is
   no `banking.int.test.ts`. Phase 6's COGS posting was then built on top of it. This is the
   highest-risk item in the repo.
2. **The authorization-boundary matrix stops at Phase 4.** `CONTROLLERS` in
   `apps/api/test/authorization-boundary.int.test.ts` ends at `FxRevaluationController`, so 29
   banking + 14 inventory endpoints have no permission or cross-tenant proof. `PHASE6_TODO.md`
   claimed this was done; that checkbox was corrected on 2026-09-02. **The structural fix matters
   more than the backfill:** the suite's "keeps the matrix synchronized" test compares `ENDPOINTS`
   against `discoverOrganizationEndpoints(CONTROLLERS)`, both hand-maintained, so a controller
   omitted from both is invisible. Stage 2B.2 replaces the hardcoded array with a walk of the
   booted Nest module graph so future phases fail loudly instead of shipping uncovered.
3. **`JournalLine` has no dimension columns.** Phase 7 profitability and Phase 9 dimension-filtered
   reports both need them; `InvoiceLine.projectTag` is free text, not a relation. See D1.
4. **`LedgerService.trialBalance` reduces every posted journal line in memory.** Fine for one
   report, fatal as the base of Phase 9's ~30. See D2 and Stage 4.1.
5. **No domain event bus.** A Phase 10 blocker, not a Phase 9 one, but decide during Phase 9.

### Recently closed (2026-09-02)

- CI was red on `main`: two lint errors (`csv.ts` wrote the U+FEFF BOM it strips as a literal;
  `inventory-workbench.tsx` had two unused icon imports) and 22 unformatted files, all from Phases
  5 and 6 skipping the gates. Fixed on `chore/verification-closure`; lint, format, typecheck, and
  all 112 unit tests are green.
- `BUILD_ROADMAP.md`'s status snapshot and Phase 5 section were two phases stale and have been
  synced; this file was rewritten.

## 2. Environment quirks worth remembering

All still true (see `docs/PHASE3_TODO.md` "After 3H" and `PHASE4_TODO.md` findings for details):

- `npx prisma migrate dev` hard-fails non-interactively; use the shadow-db `migrate diff` dance
  (create `retailbooks_shadow`, diff with `--shadow-database-url`, hand-create the timestamped
  folder, `migrate deploy`, drop the shadow). **Never edit a migration folder after any database
  has applied it — add a new folder instead** (Phase 4 hit this twice; recovery required
  `_prisma_migrations` marker surgery, restored via `prisma migrate resolve --applied`).
  PowerShell's `Out-File -Encoding utf8` writes a BOM Postgres rejects — strip it with
  `[System.IO.File]::WriteAllText(..., UTF8Encoding($false))`.
- Integration suite runs against `retailbooks_test` (auto-provisioned by `migrate deploy` from
  `test/support/database.ts`), NOT the dev `retailbooks` DB.
- **Run `npm run infra:up` first.** Other projects' Postgres containers are often running on this
  machine, which reads as "the DB is up" when RetailBooks' own containers are not.
- The boundary-matrix sweep legitimately needs ~50–60s (~195 endpoints × 8 roles) and carries a
  180s timeout — don't revert it to defaults. It needs raising when Stage 2B adds ~43 endpoints.
- Golden-path scripts: boot isolated API+worker via `node dist/src/main.js` / `dist/src/worker.js`
  on a scratch `API_PORT` with env from `apps/api/.env`; signup requires `displayName`;
  verification tokens come from Mailpit HTTP (`localhost:58025`, `/api/v1/messages` then
  `/api/v1/message/:id`, regex `token=([A-Za-z0-9_-]+)`); delete synthetic orgs (cascade) AND
  standalone `users` rows afterwards.
- Demo-org roles go stale vs `roles-catalog.ts`; use fresh synthetic orgs for scripted walkthroughs.

## 3. Conventions still worth knowing

Tenant scoping via `organizationId`; BigInt money as strings over the wire; immutable posted
journals reversed not edited; `$transaction` + `writeAuditEvent` together; permission keys land in
FOUR places (catalog keys array + entries, roles-catalog, contracts `permissionKeySchema`,
contracts group enum). Additionally:

- New posting code should declare a `PostingRule` and post through `PostingRulesService`
  (exported from `OrganizationsModule`) rather than calling `postJournalFromLines` directly.
- Sweep/occurrence claims must use their own idempotency operation namespace, never share the rule
  event's namespace (the executor treats an existing record under the operation as its completed
  result).
- System accounts resolve only via `accountBySystemKey` — never codes/names.
- `docs/PHASE<N>_TODO.md` files are the durable milestone records; BUILD_ROADMAP sections are
  their rollups; HANDOVER.md is refreshed each close-out.
- **Roll the roadmap section up in the same commit as the phase, not as a follow-up step.** Phase 5
  drifted for two phases precisely because that roll-up was optional and got skipped at close-out.
- **Never check a box you have not verified.** Phase 6's boundary-matrix item was checked off while
  the work was never done, which is worse than leaving it open — it hides the gap from the next
  session instead of flagging it.
