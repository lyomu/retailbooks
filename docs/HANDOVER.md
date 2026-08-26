# Handover Prompt — RetailBooks Global Accounting Platform

**Project:** `c:\Users\gmnyo\Desktop\Engineering projects\retailbooks` — a multi-tenant, global,
double-entry accounting & invoicing web platform (monorepo: `apps/api` NestJS, `apps/web` Next.js,
`packages/*` shared libs).

## 1. Where things stand

**Phase 4 (Accounting Engine remainder) is complete and verified** as of the Phase 4 close-out
commit (see `git log`). All milestones 4A–4G are coded and verified; `docs/PHASE4_TODO.md`'s
checkboxes are checked with implementation notes, and `docs/BUILD_ROADMAP.md`'s Phase 4 section +
status snapshot match. Suites at close: unit 74 (api) + 25 (accounting-core) + 7 (localization) +
5 (ui), integration **238 tests across 32 files**, typecheck/lint/format clean, production builds
green, migration drift zero both directions. The three Phase-4 scoping decisions (posting-rule
library = option (c); Recurring Journal now; deferred testing) were made explicitly via plan mode
and are recorded at the top of `docs/PHASE4_TODO.md`.

What Phase 4 added, in one paragraph each:

- **Posting-rule library** (`apps/api/src/posting-rules/`): declarative rules → validated lines →
  `postJournalFromLines`. Journals carry a new nullable `posting_rule` column (`event@vN`).
- **Opening Balances wizard** (organizations/opening-balances.*): batches with account lines +
  contact-level AR / vendor-level AP party detail; party lines are the only path to the AR/AP
  control accounts; balanced-import validation hard-gates finalize.
- **Recurring Journal** (organizations/recurring-journals.*): cadence templates posting through the
  library; occurrence claims live in a separate `'RECURRING_JOURNAL_CLAIM'` idempotency namespace
  from the posting's own `'RECURRING_JOURNAL_GENERATE'` — keep them separate.
- **FX Revaluation batch** (organizations/fx-revaluation.*): restates foreign-currency monetary
  positions per account×currency at the reporting rate, posts only the delta to fx_gain/fx_loss;
  unique per run date. `prepareFxPosting`'s per-journal conversion is untouched.
- **Rounding policy**: `RoundingMode`+unit on OrganizationPreference (ACCOUNTING section),
  `computeCashRoundingDelta` in accounting-core, `RoundingService#postAdjustment` wiring the
  previously-unwired `rounding` system account.
- **Pilot migration**: `InvoicesService#issueInvoice` posts via `sales/invoice-posting-rule.ts`
  with byte-identical output; its tests passed unmodified. The other six hand-rolling services are
  intentionally NOT migrated — that's recorded as an open roadmap item.

**Phase 5 (Banking & Reconciliation) is in progress, backend-complete, UI partly built.** Governing
instruction for this phase, given explicitly by the user: **"fix it so that we call phase 5 done. a
rule, code first, we will write tests later."** No test files are to be written and no
lint/prettier/`npm test`/build runs are to happen this session — only `tsc --noEmit` as a
compileability check. This mirrors the Phase 3 precedent of one deferred verification pass, except
here the deferral was explicit and total (not just "batched to the end").

Done so far:

- **Schema**: `FinancialAccountType`/`StatementImportFormat`/`StatementImportStatus`/
  `BankTransactionDirection`/`BankTransactionDisposition`/`MatchTargetType`/`ReconciliationStatus`/
  `TransferStatus` enums + `FinancialAccount`/`StatementImport`/`BankTransaction`/`Match`/
  `BankRule`/`Reconciliation`/`ReconciliationClearedTransaction`/`Transfer` models, all in
  `apps/api/prisma/schema.prisma`. A pre-existing draft of this schema was found corrupted (UTF-8
  BOM + double-encoded comments) and missing back-relations; both were fixed, `npx prisma validate`
  passes clean.
- **Migration applied**: `apps/api/prisma/migrations/20260826091556_add_phase5_banking/` was
  generated via the documented shadow-db `migrate diff` workaround (§2 above) and applied to the
  dev DB with `prisma migrate deploy`. Prisma client regenerated. This migration is **not yet
  committed** — it's new/untracked in the working tree along with the rest of Phase 5.
- **Backend**: all of `apps/api/src/banking/` — `financial-accounts.*`, `bank-rules.*` (+
  `bank-rule-matching.ts`, a pure condition-matching engine), `statement-imports.*` (+ `csv.ts`
  hand-rolled parser, `bank-transaction-fingerprint.ts` sha256 dedup key), `bank-transactions.*` (+
  `bank-transaction-posting-rule.ts`), `transfers.*` (+ `transfer-posting-rule.ts`, handles
  cross-currency legs via `CurrencyService`/fx_gain/fx_loss), `reconciliations.*`, all registered in
  `banking.module.ts` and `app.module.ts`. All posting goes through `PostingRulesService` per the
  Phase 4 convention (§3 above). `npx tsc --noEmit` in `apps/api` is clean.
- **Permissions**: 11 `banking.*` keys added to `permission-catalog.ts` (group `'Banking'`),
  `READ_ONLY_BASELINE` gets the 5 `.view` keys, ADMIN and ACCOUNTANT get the full 11 — deliberately
  **SALES and PURCHASES roles get none** (banking is accounting-team territory, a judgment call).
  No new `SYSTEM_ROLE_KEYS` entry.
- **Contracts**: `'Banking'` added to the permission group enum, all 11 keys added to
  `permissionKeySchema`, and a full `// --- Phase 5: Banking & Reconciliation ---` section appended
  to `packages/contracts/src/index.ts` with every entity's Zod schema + list/detail response
  wrappers + create/update DTOs + inferred types. `npx tsc --noEmit` in `packages/contracts` is
  clean.
- **UI — in progress**: a background agent was dispatched (not yet confirmed complete at handover
  time) to build three of the six screens — Financial Accounts, Bank Rules, Transfers — each
  mirroring an existing sibling workbench (`vendors-workbench.tsx`, `payments-made-workbench.tsx`)
  exactly. **Not yet started**: Statement Import wizard (CSV upload via `apiUpload`, needed a small
  extension to `apps/web/src/lib/api.ts`'s `apiUpload()` to accept extra form fields alongside the
  file — that extension is done, committed to the working tree, and ready to use), Bank Transactions
  workbench (categorize/split/exclude/match/unmatch actions, feeds off suggestions from Bank
  Rules), Reconciliation screen (start/clear/unclear/complete/reopen workflow, zero-tolerance
  difference gate). **Also not yet done**: nav wiring in `apps/web/src/components/app-shell.tsx`
  (needs a new "Banking" `NavigationGroup` — no items in any group are currently permission-gated at
  the nav-config level, they just route to pages that self-gate via `ForbiddenState`, so add all six
  Banking items unconditionally, mirroring the existing group shape), and
  `docs/PHASE5_TODO.md` (doesn't exist yet — create it mirroring `PHASE3_TODO.md`'s/
  `PHASE4_TODO.md`'s structure once the UI is done).

All full API route paths, DTO shapes, and contract schema field names for every Phase 5 entity are
already known/documented (was gathered in-session immediately before this handover) — the next
session should read `apps/api/src/banking/*.controller.ts` directly rather than re-deriving routes,
they're short and explicit.

No `git commit` has happened for any Phase 5 work yet.

## 2. Environment quirks worth remembering

All still true from previous phases (see `docs/PHASE3_TODO.md` "After 3H" and `PHASE4_TODO.md`
findings for details):

- `npx prisma migrate dev` hard-fails non-interactively; use the shadow-db `migrate diff` dance
  (create `retailbooks_shadow`, diff with `--shadow-database-url`, hand-create the timestamped
  folder, `migrate deploy`, drop the shadow). **Never edit a migration folder after any database
  has applied it — add a new folder instead** (Phase 4 hit this twice; recovery required
  `_prisma_migrations` marker surgery, restored via `prisma migrate resolve --applied`).
  PowerShell's `Out-File -Encoding utf8` writes a BOM Postgres rejects — strip it with
  `[System.IO.File]::WriteAllText(..., UTF8Encoding($false))`.
- Integration suite runs against `retailbooks_test` (auto-provisioned by `migrate deploy` from
  `test/support/database.ts`), NOT the dev `retailbooks` DB.
- The boundary-matrix sweep legitimately needs ~50–60s (~195 endpoints × 8 roles) and carries a
  180s timeout — don't revert it to defaults.
- Golden-path scripts: boot isolated API+worker via `node dist/src/main.js` / `dist/src/worker.js`
  on a scratch `API_PORT` with env from `apps/api/.env`; signup requires `displayName`;
  verification tokens come from Mailpit HTTP (`localhost:58025`, `/api/v1/messages` then
  `/api/v1/message/:id`, regex `token=([A-Za-z0-9_-]+)`); delete synthetic orgs (cascade) AND
  standalone `users` rows afterwards. A ready-made Phase 3 script shape lives in git history if
  needed; extend through banking once Phase 5 exists.
- Demo-org roles go stale vs `roles-catalog.ts`; use fresh synthetic orgs for scripted walkthroughs.

## 3. Conventions still worth knowing

Everything from earlier handovers holds (tenant scoping via `organizationId`, BigInt money as
strings over the wire, immutable posted journals reversed not edited, `$transaction` +
`writeAuditEvent` together, permission keys land in FOUR places — catalog keys array + entries,
roles-catalog, contracts `permissionKeySchema`, contracts group enum). Additionally after Phase 4:

- New posting code should declare a `PostingRule` and post through `PostingRulesService`
  (exported from `OrganizationsModule`) rather than calling `postJournalFromLines` directly.
- Sweep/occurrence claims must use their own idempotency operation namespace, never share the rule
  event's namespace (the executor treats an existing record under the operation as its completed
  result).
- System accounts resolve only via `accountBySystemKey` — never codes/names.
- `docs/PHASE<N>_TODO.md` files are the durable milestone records; BUILD_ROADMAP sections are
  their rollups; HANDOVER.md is refreshed each close-out.

## 4. Phase 5 preview (from the roadmap)

Entities: `FinancialAccount`, `StatementImport`, `BankTransaction`, `Match`, `Reconciliation`,
`BankRule`, `Transfer`. Key acceptance: duplicate-fingerprint detection on re-import; matches
cannot double-allocate sources; reconciliation completes only at zero difference and locks;
transfers post balanced linked journals. This will be the first consumer of the rounding hook and
a natural second candidate for migrating a posting flow onto the rule library (Transfers).

## 5. Plan file (supplementary, not durable across machines/sessions)

Phase 4's scratch plan lived at `C:\Users\gmnyo\.claude\plans\*.md`. Treat the
`docs/PHASE*_TODO.md` files as source of truth where they disagree; start a fresh plan file for
Phase 5.
