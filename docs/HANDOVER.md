# Handover Prompt — RetailBooks Global Accounting Platform

**Project:** `c:\Users\gmnyo\Desktop\Engineering projects\retailbooks` — a multi-tenant, global,
double-entry accounting & invoicing web platform (monorepo: `apps/api` NestJS, `apps/web` Next.js,
`packages/*` shared libs).

**Last refreshed:** 2026-09-03.

## 1. Where things stand

Seven of fourteen phases have code, and all seven now meet the roadmap's "done and verified" bar
apart from Phase 1's hardening debt.

| Phase                      | State                                                          |
| -------------------------- | -------------------------------------------------------------- |
| 1 Foundation               | Functionally complete; hardening/test debt open (Milestone 1J) |
| 2 Sales                    | Complete and verified (2A–2K)                                  |
| 3 Purchases                | Complete and verified (3A–3H)                                  |
| 4 Accounting Engine        | Complete and verified (4A–4G)                                  |
| 5 Banking & Reconciliation | Complete and verified (5A–5E)                                  |
| 6 Inventory                | Complete and verified (6A–6E)                                  |
| 7 Projects & Time          | Complete and verified (7A–7F)                                  |
| 8 Globalization            | Complete and verified (8A–8E)                                  |
| 9–14                       | No code                                                        |

**The active plan is `docs/EXECUTION_PLAN.md`.** It sequences the remaining verification debt
(Stages 0–4) and Phases 7–9 (Stages 5–7), and records three decisions (D1 ledger dimensions,
D2 report query strategy, D3 country-pack DB model). All three are decided; D1 is implemented.
Read it before picking up work. **Next up is Stage 7 (Phase 9, Reporting), the largest phase in this plan — engine-first, reports in batches.**

### What is genuinely open, in priority order

1. **Phase 8 is ready to open.** Stages 0–5 are closed and D3 is decided. Start at
   `EXECUTION_PLAN.md` Stage 6. Phase 8 carries the most legal risk of the three remaining phases:
   the compliance-claim rules are not cosmetic, and the Kenya pack must keep its explicit
   _demonstration_ labelling through the migration to a DB model.
2. **Two ADR 0011 follow-ups**, each recorded in `PHASE1_TODO.md` with its owning phase: an
   attachment content-type allowlist, and validating the environment once at startup
   (`packages/config` is still a stub, and only `SECURITY_PEPPER` asserts itself).
3. **No domain event bus.** A Phase 10 blocker, not a Phase 9 one, but decide during Phase 9.
4. **Cross-module scenario 1 (§18.1)** is the one Phase 5 acceptance item still open. Banking
   import/match/reconcile are covered in isolation, but not the full chain from quote through
   acceptance, invoice, partial and final payment, to P&L/AR/GL agreement.
5. **Stage 4.5–4.8** — visual-regression baselines, the WCAG 2.2 AA review, and the backup/restore
   drill — are folded into Phase 14 by decision, not by drift. See `PHASE1_TODO.md` Milestone 1J.

### Decided (2026-09-02) — the execution plan's three pre-Phase-7 decisions

- **D1 ledger dimensions → option (a). Implemented in Phase 7.** `JournalLine` carries nullable
  `projectId` + `tagId`, frozen at post time like the tax snapshot. Profitability reads from the
  ledger and reconciles to the P&L by construction. No backfill: historical journals predate
  projects. Phase 9's dimension filters read the same columns. One consequence worth knowing
  before adding a dimensioned document type: **the dimension must be chosen before the document
  posts.** `Expense` needed its own `projectId` for exactly this reason — attributing cost after
  posting is impossible without restating a frozen line, which D1 forbids.
- **D2 report query strategy → SQL aggregation.** Rule and budgets in `docs/PERFORMANCE.md`;
  `trialBalance` is the reference implementation Phase 9's engine copies.
- **D3 country packs → DB `CountryPack` model in Phase 8**, seeded from `jurisdiction-catalog.ts`,
  which stays as the fresh-database fallback. Kenya keeps its explicit _demonstration_ labelling.

Full reasoning, including what was rejected, is in `EXECUTION_PLAN.md` §"Decisions to make before
Stage 5".

### Recently closed (2026-09-03)

- **Phase 7 (Projects & Time)** shipped: five entities, D1's ledger dimensions, 25 endpoints, seven
  screens, and `projects.int.test.ts` (14 tests). `docs/PHASE7_TODO.md` has the detail.
- The boundary matrix's module-graph walk (Stage 2B.2) fired for the first time on a phase written
  after it, failing until `ProjectsController`'s 25 routes were declared. It works.
- Phase 7's test pass found that project profitability reported cost as zero and margin as equal to
  revenue on every project, because nothing dimensioned the expense side of the ledger. Fixed by
  giving `Expense` a `projectId` chosen before posting.
- **The integration suite's concurrency-replay tests flake occasionally under full-suite load.**
  Six concurrent requests serialize behind one idempotency advisory lock and a waiter can exceed
  its transaction timeout; the invariant they guard has held every time. They pass in isolation.
  Before chasing one as a regression, re-run it alone — and check `docker ps -a`, because a killed
  Postgres container produces the same signature across many files at once.

### Recently closed (2026-09-02)

- CI was red on `main`: two lint errors (`csv.ts` wrote the U+FEFF BOM it strips as a literal;
  `inventory-workbench.tsx` had two unused icon imports) and 22 unformatted files, all from Phases
  5 and 6 skipping the gates. Fixed on `chore/verification-closure`; lint, format, typecheck, and
  all 112 unit tests are green.
- `BUILD_ROADMAP.md`'s status snapshot and Phase 5 section were two phases stale and have been
  synced; this file was rewritten.
- **Phase 5 verification closed.** `apps/api/test/banking.int.test.ts` (16 tests) covers
  duplicate fingerprints, match double-allocation, categorize/split/exclude posting, same- and
  cross-currency transfers with void-by-reversal, and the reconciliation zero-difference gate,
  lock and reopen.
- **The boundary matrix now derives controllers from the booted Nest module graph.** The old
  hand-maintained `CONTROLLERS` array could not detect its own omissions, which is how 43
  endpoints shipped uncovered. Verified by deleting an entry and confirming the suite names it.
  A new controller now fails this suite the day it is registered.
- **Migration drift fixed.** Three index names exceeded PostgreSQL's 63-byte identifier limit,
  so the server truncated them and dropped the `_idx` suffix while Prisma expected its own
  shorter name. Renamed in `20260902130000_fix_phase6_index_names`; drift is now zero both ways.
- Whole-repo gate green: lint, prettier, typecheck, 112 unit tests, 34 integration files / 258
  tests, zero drift, both production builds.
- **Stage 4.1–4.4 closed** (the Phase 1 hardening debt that protects Phases 7–9):
  - Four ledger read paths reduced every posted journal line in Node; they now aggregate in
    PostgreSQL. `docs/PERFORMANCE.md` records the rules, the budgets, and the measured plans —
    including the non-obvious one, that a relation filter must repeat `organizationId` on both
    sides or the planner seq-scans every tenant's journals.
  - `audit-coverage.int.test.ts` asserts audit coverage structurally rather than from a list of
    actions. It found that a reversal journal had no audit row naming it, since `reverseJournal`
    builds its journal outside `finalizePosting`. Fixed.
  - `DESIGN.md` re-derived from the code. Tokens had not drifted; the workbench page shape, the
    self-gating rule, and five shared primitives were undocumented.
  - ADR 0011 reviewed the untrusted-file-input surfaces. Three upload endpoints were unbounded and
    object keys used the raw client filename; both fixed, along with a missing 413 mapping.
- Gate after Stage 4: 112 unit tests, **35 integration files / 267 tests**, zero drift, both builds.

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
- The boundary-matrix sweep legitimately needs ~60s (243 endpoints × 8 roles) and carries a 240s
  timeout — don't revert it to defaults. Raise it again when a phase adds a batch of controllers.
- `retailbooks_perf` is a **disposable** scratch database for query-plan work, not part of any
  suite — see `docs/PERFORMANCE.md` "Re-checking" for how to rebuild and drop it. Two tenants
  matter when you do: with one, a missing tenant predicate produces the same plan either way.
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
- **Totals aggregate in the database, and relation filters repeat `organizationId` on both sides.**
  `docs/PERFORMANCE.md` has the rules, the budgets, and the measured plans. The second half of that
  is easy to miss: with the tenant predicate only on `journal_lines`, PostgreSQL seq-scans every
  tenant's journals rather than using the index.
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
