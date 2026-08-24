# Handover Prompt — RetailBooks Global Accounting Platform

**Project:** `c:\Users\gmnyo\Desktop\Engineering projects\retailbooks` — a multi-tenant, global,
double-entry accounting & invoicing web platform (monorepo: `apps/api` NestJS, `apps/web` Next.js,
`packages/*` shared libs).

## 1. Orient yourself first

Before writing any code, read these in order:

1. `docs/BUILD_ROADMAP.md` — the master 14-phase task checklist (Foundation → Sales → Purchases →
   Accounting Engine → Banking → Inventory → Projects/Time → Globalization → Reporting → Automation →
   Portals → Platform Admin → AI → Hardening). This is the authoritative source of what's done and
   what's next. **Read its "Testing strategy" section carefully — it defines the required build/test
   sequencing (see §5 below).**
2. `docs/PHASE1_TODO.md` — detailed milestone-by-milestone record for Phase 1 (Foundation), including
   implementation notes and ADR links. More granular than the Phase 1 section of BUILD_ROADMAP.md.
3. `docs/adr/000*` — architecture decision records for Phase 1 (tenancy, auth, roles/permissions,
   ledger, tax engine).
4. `starter/global_accounting_platform_build_specification_v1.docx` and
   `starter/global_accounting_platform_master_blueprint.docx` — the original product specs both
   roadmap docs were derived from. Consult these for exact field/rule/state definitions when a roadmap
   checklist item is ambiguous.

## 2. Current state (as of 2026-08-24)

- **Phase 1 (Foundation) is functionally complete**: auth/sessions, multi-tenant orgs + onboarding,
  8-role RBAC, localization/country-pack catalog, fiscal years/periods, document numbering, full
  double-entry ledger with FX posting/reversal, tax engine, audit log — all with matching web UI.
  22 Prisma models, 10 migrations, 74 passing DB-free tests.
- **Open hardening/test debt on Phase 1** (see BUILD_ROADMAP.md's Phase 1 section and
  PHASE1_TODO.md's Milestone 1J): visual regression baselines, WCAG review, performance review,
  audit-log coverage review, backup/restore drill, threat model/dependency review, DESIGN.md update.
  Identity, tenant-isolation, authorization-boundary, accounting-invariant/idempotency/concurrency, and
  end-to-end-journey tests are all now done.
- **Phases 2–14 have zero code** — no modules, Prisma models, routes, or pages exist yet for Sales,
  Purchases, Banking, Inventory, Projects, Reporting, Automation, Portals, Platform Admin, or AI.

## 3. What to work on

Follow the **recommended build order** at the bottom of `docs/BUILD_ROADMAP.md`: close remaining
Phase 1 hardening debt where it blocks you, then build **Phase 2 — Sales** as the first complete
vertical slice (UI → API → ledger → report), since it's the next phase in sequence and the spec
explicitly calls it out as the first full vertical slice to prove the architecture end-to-end.

Unless told otherwise, don't jump ahead to a later phase (e.g. Inventory or Reporting) — later phases
assume entities/patterns established by earlier ones (e.g. Phase 6 Inventory's COGS posting depends on
Phase 2's invoice/sale flow; Phase 9 Reporting depends on Sales/Purchases data existing to report on).

## 4. Non-negotiable conventions

(See "Platform-wide contracts" in `docs/BUILD_ROADMAP.md` for the full list.)

- Every tenant-owned table row carries `organization_id`; enforce scoping in the service + guard
  layer, never trust it from client input.
- Money is **always** fixed-precision integer minor units (`BigInt`) — never floating point. Reuse
  `packages/accounting-core` for money/tax/FX math.
- Posted ledger records are immutable — corrections happen via reversal, never edits. Reuse
  `LedgerService` in `apps/api/src/organizations/ledger.service.ts` for all posting; don't hand-roll
  new posting logic per module.
- Every financial mutation needs an audit event (extend the existing `AuditEvent`/`SecurityEvent`
  pattern).
- Every critical screen needs loading/empty/error/no-permission/archived-void/success states — reuse
  `packages/ui`'s `EmptyState`/`ForbiddenState`/`Loading`/`Toast` primitives.
- New Zod schemas go in `packages/contracts`, shared by API and web.
- Extend `roles-catalog.ts` / `permission-catalog.ts` for any new module's permissions rather than
  inventing a parallel authorization mechanism — several roles (SALES, PURCHASES,
  INVENTORY_MANAGER, PROJECT_MANAGER) are already scaffolded as placeholders waiting for their real
  permission sets.

## 5. Build/test sequencing — build first, verify in a follow-up pass

Within a phase, implement **Data model → Backend/API → UI → Business rules** before working through
that phase's **Tests/acceptance** checklist — don't block feature work on writing the full test list
first. This continues the pattern Phase 1 already used (every 1C–1I milestone note deferred tests to a
later "verification pass," which then caught the suite up in one dedicated stage).

Two things do **not** get deferred, because they're cheap now and expensive to discover late in an
accounting product:

- **Money-invariant checks as you build the posting logic itself**: posting always balances, reversal
  is exact, payment/credit allocation can never over-apply, stock can never go negative without a
  traceable movement. Write these alongside the implementation, not as a follow-up task.
- **A phase's `Tests/acceptance` checklist must be fully checked off before that phase is marked done
  or a later dependent phase starts building on it** — e.g. don't start Phase 6 Inventory's COGS
  posting on top of unverified Phase 2 invoice posting. "Deferred" means "after the feature work in
  this phase," not indefinitely.

Everything else — full integration suites, accessibility, visual regression, concurrency/load
testing — can genuinely wait for the verification pass, same as Phase 1 did.

## 6. Process

- **Work in vertical slices**: for each roadmap item, implement data model → migration → backend
  service/API → contracts schema → UI screen → tests, rather than building a whole layer across all
  modules first.
- **Update the checklist as you go**: check off `- [ ]` → `- [x]` in `docs/BUILD_ROADMAP.md` only once
  a task is implemented _and verified_ (tests passing per §5's rules), not just coded. For Phase 1
  items, update `docs/PHASE1_TODO.md` first (it's the detailed record) and keep BUILD_ROADMAP.md's
  rolled-up summary in sync.
- Once a new phase starts in earnest, consider creating a `docs/PHASE<N>_TODO.md` in the same style as
  `PHASE1_TODO.md` for detailed milestone tracking, keeping the BUILD_ROADMAP.md entry as its
  rolled-up summary — the pattern Phase 1 already established.
- Run the full test suite (`npm test`, `npm run test:integration`) and typecheck/lint before
  considering any task fully done. CI (`.github/workflows/ci.yml`) also runs a Prisma migration drift
  check — make sure new migrations don't drift from `schema.prisma`.
- Don't mark a phase's release gate complete until its "Tests/acceptance" checklist items and any
  relevant cross-module acceptance scenario (build spec §18, listed under Phase 14 in the roadmap)
  actually pass.
