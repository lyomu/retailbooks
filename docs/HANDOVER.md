# Handover Prompt — RetailBooks Global Accounting Platform

**Project:** `c:\Users\gmnyo\Desktop\Engineering projects\retailbooks` — a multi-tenant, global,
double-entry accounting & invoicing web platform (monorepo: `apps/api` NestJS, `apps/web` Next.js,
`packages/*` shared libs).

## 1. Where things stand

**Phase 3 (Purchases) is complete and verified as of the Phase 3 close-out commit** (the commit
containing this file's change — see `git log` for "close the Phase 3 verification pass"). All
milestones 3A–3H are coded, the deferred comprehensive verification pass ran to completion, and
`docs/PHASE3_TODO.md`'s checkboxes are all checked with per-milestone implementation notes. The
verification record (what ran, what passed, the three stale Phase 1/2 test pins that were caught and
fixed wrong-vs-right style) lives in that file's "After 3H" section; `docs/BUILD_ROADMAP.md`'s Phase
3 rollup is updated to match. Suites at close: 73 unit + 215 integration tests green, typecheck/
lint/format clean, both production builds green, migration drift zero in both directions, and a
26-check HTTP golden path through purchase→bill→payment on a fresh synthetic organization.

**Next up is Phase 4 — Accounting Engine** (`docs/BUILD_ROADMAP.md`, `## Phase 4`; build spec §6;
blueprint §10), but **it has not started** — no code exists for it yet. Before writing any Phase 4
code, several explicit scoping decisions must be settled with the user via plan mode (they are
recorded in §5 below): most of the accounting engine already shipped in Milestone 1G, so Phase 4 is
the remainder — Opening Balances wizard, Recurring Journal, FX Revaluation, rounding policy, posting-
rule library generalization, and the canonical posting acceptance tests — and two of those items
(posting-rule generalization scope; Recurring Journal now-vs-Phase-10) require an explicit product
call before coding begins.

## 2. How Phase 3 was verified (for reference when verifying Phase 4)

Phase 3 was built with all testing deferred to one end-of-phase pass (user-directed); that risk was
accepted knowingly and it played out cleanly this time — the pass found no logic bugs in the new
code, only stale pre-Phase-3 test pins (documented in PHASE3_TODO's findings list). The roadmap's
standing rule still applies though: **money-invariant checks are written as posting logic is built,
not deferred**, and a phase's own acceptance checklist must be fully checked before a dependent
phase starts. For Phase 4 — smaller and ledger-critical — per-milestone testing is likely the safer
default; confirm with the user rather than assuming the deferral carries forward.

Environment quirks worth remembering (all hit and solved during the Phase 3 close-out):

- `npx prisma migrate dev` hard-fails in this non-interactive shell. Workaround: create throwaway
  shadow DB `retailbooks_shadow` in the same Postgres (`docker exec retailbooks-postgres-1 psql ...`),
  run `prisma migrate diff --from-migrations ./prisma/migrations --to-schema-datamodel
./prisma/schema.prisma --shadow-database-url postgresql://retailbooks:retailbooks@localhost:55432/retailbooks_shadow`
  (add `--script >` to generate SQL or `--exit-code` to drift-check), hand-create the timestamped
  migration folder if generating, then `prisma migrate deploy`. **Drop the shadow DB afterwards.**
- Check for stray `nest start --watch` node processes before `prisma generate` (Windows EPERM).
- The integration suite's boundary-matrix sweep legitimately needs ~51s (8 roles × ~180 endpoints);
  it carries its own 180s timeout now — don't "fix" that back to the default.
- Golden-path scripts: boot isolated API + worker via `node dist/src/main.js` / `dist/src/worker.js`
  on a scratch `API_PORT` with the env from `apps/api/.env`; signup requires `displayName`;
  verification tokens come from Mailpit's HTTP API (`localhost:58025`, `/api/v1/messages` +
  `/api/v1/message/:id`, regex `token=([A-Za-z0-9_-]+)`); delete synthetic orgs (cascade) _and_
  standalone `users` rows from the shared dev DB when done.
- Demo-org roles go stale relative to `roles-catalog.ts` between sessions — use a fresh synthetic
  org for any scripted walkthrough, or re-sync role rows explicitly first.

## 3. Conventions and context still worth knowing

Everything from earlier handovers (tenant isolation via `organizationId`, BigInt money as strings
over the wire, immutable posted journals reversed not edited, `$transaction` + `writeAuditEvent`
together, controller/guard shape, document numbering via `allocateDocumentNumberWithClient`) applies
and held throughout Phases 2–3. Additionally:

- Every permission key lands in **four** places: `permission-catalog.ts` (keys array + catalog
  entry), `roles-catalog.ts` (role wiring), `packages/contracts/src/index.ts`'s
  `permissionKeySchema`, and its `group` enum. At Phase 3 close there were 109 keys, programmatically
  cross-checked as drift-free; re-run that check only if you edit either file again.
- Vendor is a standalone model (not generalized Contact) by explicit user choice; do not resurrect
  any `type: 'VENDOR'` contact path.
- `apps/api/src/common/cadence.ts` is the shared cadence helper (imported by all recurring-template
  services). Touch cadence math in exactly one place.
- System accounts are lazily seeded per organization (`vendor_credit`, code 1140, included since
  3E); a pre-existing demo org's chart won't show a new key until something needs it.
- Attachments live in `apps/api/src/attachments/` (`AttachmentsService`, no shared controller);
  BillsController/ExpensesController own nested `/attachments` routes. No `@types/multer`
  dependency — keep using the local `UploadedFileLike` type.

## 4. Phase 4 scoping notes (from the user's brief — resolve before coding)

- Most of "the accounting engine" already shipped in Phase 1 Milestone 1G (`ledger.service.ts`:
  chart of accounts, manual journals, posting engine, trial balance, reversal, per-transaction FX).
  Read that file before touching anything FX-related so batch revaluation isn't duplicated with
  what exists.
- Opening Balances wizard uses the already-reserved `accounts.opening_balances.manage` permission
  key — don't add a new one. Balanced-import validation required before finalize.
- Recurring Journal: build one-off template now (mirroring the three existing recurring-template
  services + shared `advanceCadence`) vs hold until Phase 10 defines the shared recurring engine —
  open question, ask the user.
- Rounding: a `rounding` system account already exists in `ledger-starter-chart.ts`; check whether
  it's wired to anything before assuming greenfield.
- Posting-rule library generalization is retroactive across seven shipped services
  (Invoices/Bills/CreditNotes/VendorCredits/Payments/PaymentsMade/Expenses all hand-roll
  `postJournalFromLines`). Forward-looking-only vs refactor-the-seven is the biggest decision in
  the phase — get explicit sign-off before touching shipped, tested code.
- Canonical posting acceptance tests (build spec §6 table): five of six already have de facto
  coverage from Phase 2/3 suites; only "Inventory cost on sale → Dr COGS / Cr Inventory Asset" is
  unimplemented and blocked (Inventory doesn't exist until Phase 6) — flag as blocked, don't fake.

## 5. Plan file (supplementary, not durable across machines/sessions)

This build's full incremental plan and progress log for Phase 3 lived at
`C:\Users\gmnyo\.claude\plans\buzzing-jumping-planet.md`. Treat `docs/PHASE3_TODO.md` as the source
of truth where they disagree — plan files are scratch memory, not committed artifacts. Start a fresh
plan file for Phase 4 once its scoping questions are answered.
