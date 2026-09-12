# Handover Prompt — Phase 14 (Hardening & Release)

**Project:** `c:\Users\gmnyo\Desktop\Engineering projects\retailbooks` — a multi-tenant, global,
double-entry accounting & invoicing web platform (monorepo: `apps/api` NestJS, `apps/web` Next.js,
`packages/*` shared libs).

**Written:** 2026-09-12. **Branch:** `chore/verification-closure` (35 commits ahead of `main`,
nothing behind — Phases 10-12 are not on `main` yet; that's a separate, pre-existing fact, not
something to fix as part of Phase 14 unless asked).

## 1. What Phase 14 is

Build spec §16; blueprint §17. It is the final release gate across the *whole* platform, not a
module with its own screens. Per `docs/BUILD_ROADMAP.md:828-866`, it has two halves:

1. **Nine hardening tracks**: accounting golden-scenario suite, tenant isolation, security,
   reliability, performance, accessibility, migration/import, operations, launch sign-off.
2. **Eight cross-module acceptance scenarios** (build spec §18), of which 6 are still unproven.

No code for Phase 14 exists yet. Phase 13 (AI Layer) also has no code and sits before it in the
roadmap's build order, but the user has explicitly directed work at Phase 14 first — don't block on
Phase 13.

**Live tracker:** `docs/GAPS.md`. It has a checkbox for every open item across the whole project,
including all of Phase 14's, with item numbers matching this document. **Read it first, and update
it — checking items in the same commit as the work that closes them — every time you touch one of
its items.** Don't let it drift out of sync with reality the way `EXECUTION_PLAN.md`'s own
checkboxes did (see `docs/GAPS.md` section G for that exact failure mode, three times over).

## 2. The one thing that will surprise you: audit before you build

Several of the "gaps" read like missing features but are actually missing *proof*. A quick grep
before starting this handover found:

- **Idempotency keys already exist** on invoices, payments, credit notes, bills, expenses,
  payments-made, vendor credits, banking transfers/transactions, projects, ledger, opening
  balances, recurring journals, and posting rules — 28 files reference `idempotenc*`. Roadmap item
  E34 ("idempotency keys on every posting endpoint") may already be satisfied; what's missing is an
  audit against the full posting-endpoint list, not necessarily new code.
- **Domain event emission already exists** widely — `DomainEventsService` is called from
  automation, banking, inventory, ledger, purchases (bills, payments-made), sales (invoices,
  payments), and organizations. Roadmap item E36 is likely mostly done; again, audit first.
- **PDF generation exists** (`document-rendering.service.ts`, `pdf-templates.ts`, invoice/
  quote/credit-note services, `report-artifact.service.ts`) — check whether it renders from data
  frozen at issue time or re-renders live from current (possibly since-edited) data before assuming
  item E38 needs new plumbing.
- **Optimistic concurrency (`version` field) exists** on exactly two models: `ApprovalPolicy` and
  `WorkflowRule` (both Phase 10). Item E35 ("beyond the ledger") is genuinely thin — most financial
  records have no version column.
- **No cross-module scenario test file exists yet** (`apps/api/test/` has no `scenario`/`cross`/
  `golden`/`e2e` named integration test). Section B's 6 scenarios are a real, from-scratch gap.

Treat every item in `docs/GAPS.md` sections A2 and E as "verify, and build only the delta" rather
than "build from zero." Every prior phase's pattern-match here (Phase 5, 6, 7 code-first passes)
found real defects during the *verification* pass, not before it — expect the same.

## 3. Recommended sequencing

Dependencies, not just priority:

1. **`docs/GAPS.md` item 29 — startup environment validation.** Small, isolated, and the only item
   in the whole tracker that's a live correctness risk today (a production boot with a missing
   `DATABASE_URL`/`REDIS_URL`/`S3_*` currently succeeds silently). `packages/config` is a stub
   (`package.json` + `README.md`, no source) — see ADR 0011 §"Secret handling" for the full finding
   and its two named follow-ups (this one, and the content-type allowlist, which already landed in
   Phase 11). Do this first: it's cheap, self-contained, and closes a real hole.
2. **Section B — the 6 unproven cross-module scenarios.** Highest value per hour: they exercise
   already-built code end to end, following the exact pattern that found real defects in Phases 5,
   6, and 7 (see `docs/BUILD_ROADMAP.md`'s closing note under Phase 7's summary for that pattern
   stated explicitly). Scenario 1 (quote→payment→reconcile) is named as *the* end-to-end gap and
   should go first; it also closes Phase 2's and Phase 5's last open acceptance boxes as a
   side-effect. Do the audit from §2 above as you write each scenario — you'll be exercising the
   idempotency and domain-event code paths anyway.
3. **Section E platform-wide contracts (items 34-38).** Audit each against the current code (§2
   above) before writing anything. Where a real gap remains (most likely: `version` fields beyond
   Phase 10's two models, and confirming PDF snapshot immutability), scope it as its own small
   piece rather than one giant sweep.
4. **Section A2 tracks 10-17** (tenant isolation, security, reliability, performance, accessibility,
   migration/import, operations, launch). Tenant isolation and security overlap heavily with the
   existing `authorization-boundary.int.test.ts` (module-graph-derived, so it can't miss a new
   controller) — extend rather than duplicate. **Migration/import (track 15) may be a real feature
   gap, not a test gap** — check whether CSV/bulk import exists for customers, vendors, items, and
   opening balances before assuming it's a verification pass (the banking statement importer is
   *not* the same thing). Performance testing needs production-like data volumes — no seed script
   for that scale currently exists; check `docs/PERFORMANCE.md` for what's already measured.
   Accessibility and visual-regression here subsume `docs/GAPS.md` items 30-33 (Phase 1's Stage
   4.5-4.7 debt) — close them together, not twice.
5. **`docs/GAPS.md` items 20-28** (Phase 10 tracked debt) are Phase 10's, not Phase 14's — leave
   them where they are unless the user asks you to fold them in. They're listed in GAPS.md for
   visibility, not because Phase 14 owns them.

## 4. Conventions that apply here (from `docs/HANDOVER.md` §2-3 — still all true)

- `npm run infra:up` first; other projects' Postgres containers running on this machine can read as
  "the DB is up" when RetailBooks' own aren't.
- Migrations: never edit an applied migration folder — new folder, or use the shadow-db
  `migrate diff` dance. Full recipe in `docs/HANDOVER.md` §2.
- Integration suite runs against `retailbooks_test`, auto-provisioned by `migrate deploy`.
- Tenant scoping via `organizationId` everywhere, including both sides of relation filters (see
  `docs/PERFORMANCE.md` for why the second one matters for query plans).
- Permission keys land in **four** places: catalog keys array + entries, `roles-catalog.ts`,
  contracts `permissionKeySchema`, contracts group enum.
- New posting code declares a `PostingRule` and posts through `PostingRulesService` — don't call
  `postJournalFromLines` directly.
- Sweep/occurrence idempotency claims use their own operation namespace, never share the triggering
  event's namespace.
- System accounts resolve only via `accountBySystemKey`, never codes or names.
- Test harness: `createTestHarness()` — used in all 55 current integration test files. Model any
  new scenario test file on an existing one in the same style (e.g. `inventory.int.test.ts` for
  proven scenario 2, `collaboration.int.test.ts` for a recent multi-actor flow).
- **Never check a box you haven't verified.** A false-checked box (Phase 6's boundary-matrix item)
  is worse than an honestly open one — it hides the gap from the next session.
- Roll the roadmap section up in the same commit as the work that closes it — this is the exact
  rule `docs/GAPS.md` restates for itself; Phase 5 and `EXECUTION_PLAN.md` both drifted because it
  was treated as optional.

## 5. Definition of done for a Phase 14 item

Same bar as every other phase (`docs/BUILD_ROADMAP.md:868-885`, reduced in
`docs/EXECUTION_PLAN.md`'s "Definition of done" section): migration applied with zero drift in both
directions where schema changes, permission keys wired (not placeholders), Zod contracts complete,
audit events emitted, posting *and* reversal tested where accounting-impacting, boundary matrix
covers any new controller automatically, full gate green (format, lint, typecheck, drift, unit,
integration, build), and `docs/GAPS.md` checked off with the roadmap/handover rolled up in the same
commit.

## 6. What to do first, concretely

1. Read `docs/GAPS.md` in full (already sequenced with this document).
2. Do item 29 (env validation) — small, real, self-contained.
3. Start scenario 1 (`docs/GAPS.md` §B item 1): write
   `apps/api/test/cross-module-scenarios.int.test.ts` (or similar), model it on
   `inventory.int.test.ts`, drive quote → acceptance → invoice → partial payment → final payment →
   bank import/match → reconcile, and assert P&L/AR/GL agreement at the end. Expect to find at
   least one real defect — every prior phase's first end-to-end test did.
4. Report proven vs. not-proven as you go rather than grinding silently through the whole phase —
   this project's own pacing note applies: don't run the slow suites unattended end to end without
   checking in.
