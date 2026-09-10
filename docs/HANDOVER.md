# Handover Prompt — RetailBooks Global Accounting Platform

**Project:** `c:\Users\gmnyo\Desktop\Engineering projects\retailbooks` — a multi-tenant, global,
double-entry accounting & invoicing web platform (monorepo: `apps/api` NestJS, `apps/web` Next.js,
`packages/*` shared libs).

**Last refreshed:** 2026-09-10 (Phase 12 closed; Phase 11 implemented, verification partial — not closed).

## 1. Where things stand

Twelve of fourteen phases have code. Ten meet the roadmap's "done and verified" bar (Phase 1
remains functionally complete with explicitly tracked hardening debt). Phase 10 closed on
2026-09-05 with a green whole-repo gate and named tracked debt. **Phase 11 has complete
implementation and partial verification as of 2026-09-08; Phase 12 closed on 2026-09-10 with
captured green acceptance evidence** — Phase 11's open gates are enumerated in
`docs/PHASE11_TODO.md`; Phase 12's closure evidence lives in `docs/PHASE12_TODO.md`.

| Phase                      | State                                                                                                     |
| -------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1 Foundation               | Functionally complete; hardening/test debt open (Milestone 1J)                                            |
| 2 Sales                    | Complete and verified (2A–2K)                                                                             |
| 3 Purchases                | Complete and verified (3A–3H)                                                                             |
| 4 Accounting Engine        | Complete and verified (4A–4G)                                                                             |
| 5 Banking & Reconciliation | Complete and verified (5A–5E)                                                                             |
| 6 Inventory                | Complete and verified (6A–6E)                                                                             |
| 7 Projects & Time          | Complete and verified (7A–7F)                                                                             |
| 8 Globalization            | Complete and verified (8A–8E)                                                                             |
| 9 Reporting                | Complete and verified (9A–9F)                                                                             |
| 10 Automation & Approvals  | Complete and verified (10A–10I), 64/76 checklist items; tracked debt named in `PHASE10_TODO.md` and below |
| 11 Portals & Collaboration | **Implemented, partially verified — not closed.** Ledger in `PHASE11_TODO.md`                             |
| 12 Platform Admin          | Complete and verified (12A–12J), closed 2026-09-10                                                        |
| 13–14                      | No code                                                                                                   |

**The plan is `docs/EXECUTION_PLAN.md`.** It sequenced the verification debt (Stages 0–4) and
Phases 7–10 (Stages 5–8), and records three decisions (D1 ledger dimensions, D2 report query
strategy, D3 country-pack DB model). All three are decided; D1 is implemented.
**Stages 0–8 are all closed as of 2026-09-05.** `docs/PHASE10_TODO.md` remains the durable Phase 10
record including its tracked-debt list; `docs/PHASE10_TEST_PLAN.md` documents how its remaining
test coverage was executed. Stage 9 (Phase 11) is open: implementation is complete and its own
acceptance suites pass, but the whole-repository gate has not been captured. Stage 10 (Phase 12)
closed on 2026-09-10 with captured green gates. Phases 13–14 (AI and cross-module scenarios) have
no code.

### What is genuinely open, in priority order

1. **Phase 11 owes its closing gates.** The code is written and its two dedicated acceptance suites
   pass (29/29 portal, 21/21 collaboration, plus 6/6 authorization boundary). What has _not_ been
   captured: `npm run lint`, a full-suite integration rerun after the final fixes, both production
   builds, any Playwright run at all, visual review, the design detector, and drift/replay.
   `docs/PHASE11_TODO.md` holds the evidence ledger and a three-step "what to run first" list.
   Nothing there should be promoted to verified without captured output.
2. **Phases 13–14 have no code.** AI (13) and the pre-release cross-module scenarios (14) are
   roadmap sections only. The §18.1 quote-through-payment chain remains the
   named end-to-end gap: banking import/match/reconcile are covered in isolation, but not the full
   chain from quote through acceptance, invoice, partial and final payment, to P&L/AR/GL
   agreement.
3. **Phase 10 tracked debt**, each named on its own unchecked bullet in `docs/PHASE10_TODO.md`: the
   10H approval edge-case tests (multi-level ordering, criteria boundaries, concurrent decisions,
   mid-flight policy edits, revoked permissions), Quote's bespoke approval route as an adapter into
   the policy engine, the two deferred 10F refactors (export streaming, async `202` oversized-PDF
   export), the 10E recurring unification, two 10A contract schemas, 10C's `submitter role`
   condition and state-machine documentation, 10D's field-update action, and 10I's operator docs.
4. **One ADR 0011 follow-up** remains: validating the environment once at startup
   (`packages/config` is still a stub, and only `SECURITY_PEPPER` asserts itself). The attachment
   content-type allowlist landed with Phase 11 — uploads are now checked for a supported extension,
   a matching declared MIME type, and bytes whose signature agrees with both.
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

### In progress (2026-09-08) — Phase 11 Portals & Collaboration

**Implementation is complete across 11A–11G and the two dedicated acceptance suites pass. The phase
is not closed:** lint, the full-suite integration rerun, production builds, Playwright, visual
review, the design detector, and drift/replay have not been captured. Read `docs/PHASE11_TODO.md`
before touching anything here; it lists exactly what is proven and what is not.

Eleven live defects were found and fixed by the tests written in this pass. Four are worth knowing
about because they shape how this area should be worked on:

- **`prisma as any` hid a non-existent column.** The Phase 11 services were written before the
  Prisma client was regenerated, so the delegates were reached through `as any`. Those casts
  survived the regeneration, and one of them hid `PortalsService.invite` writing a `notifiedAt`
  column that does not exist — portal invitations failed for every caller, and no compiler could
  see it. The casts are gone; if you add a Phase 11 model, regenerate and drop the cast in the same
  change.
- **The collaboration target registry selected `contactId` on every model.** Most targets — bills,
  journals, transfers, adjustments, projects — have no such column, so the panel returned 500 on
  all of them. Whether a target may be shown to a customer is the registry's `customerEligible`
  flag, never a column on the row.
- **The audit-to-activity projection cost a second write per audit event inside every posting
  transaction**, which pushed a multi-line inventory adjustment past Prisma's interactive
  transaction deadline. It is now nested in the audit insert: one round trip, one shared
  `occurredAt`. Anything else added to `writeAuditEvent` pays that cost on every posting path in
  the application — measure before adding a round trip there.
- **The demo seed asserted a hard-coded count of system-account keys** (13, against a catalog that
  had grown to 15). This failed every `e2e:prepare`, which is the real cause of the
  "managed-server lifecycle failure with no browser test IDs" recorded in earlier sessions — the
  Playwright gate was never broken; its seed was. The assertion now derives from the catalog.

Two structural changes worth carrying forward: a listing never carries an attachment download URL
any more (a re-authorized endpoint issues the short-lived link, on the generic route and on the
Bills/Expenses adapters alike), and the collaboration write routes declare their permissions with
`@RequirePermission` rather than checking inside the service, so the authorization-boundary matrix
can see them.

### Closed (2026-09-10) — Phase 12 Platform Admin

**Implementation and verification are complete; every automated suite in Milestone 12J ran and
passed.** The platform boundary is a database-backed SUPPORT / OPERATIONS / SUPERADMIN hierarchy,
with the environment allowlist retained only to bootstrap a deployment with zero grants. Mutations
write a separate atomic `PlatformAuditEvent`; tenant support views expose standing, counts, and
dates but never financial amounts.

The `/platform` console has its own shell and screens for overview analytics, organizations, users,
plans and entitlements, feature flags, country packs and tax definitions, jobs, security, and audit.
Country Packs and Tax Definitions intentionally share `/platform/country-packs`: tax metadata is a
versioned child of a country-pack draft, so the screen creates versions, edits JSON-backed defaults,
upserts nested tax versions, and drives publish/deprecate/delete lifecycle without inventing a
second global entity. The flags screen also gained an evaluation-preview group: SUPPORT and above
can preview a key against an optional country, plan, or organization and see the winning scope;
flag mutations remain SUPERADMIN-only.

Evidence captured: the original 18/18 smoke script passed against the real dev database; migration
drift was zero in both directions. A live browser pass on 2026-09-10 covered the Country Packs and
Tax Definitions editor's draft, nested-tax, persistence, and full lifecycle paths; its published
fixture was deprecated by design and its successor draft was removed. The smoke script was throwaway
and is not committed. Automated closure evidence, all green on 2026-09-10: 15/15 integration tests
across the six Phase 12 suites (`platform-authorization`, `platform-operations`, `country-packs`,
`platform-audit`, `platform-projections`, `platform-resolution`); 3/3 desktop Playwright
(--project=desktop --grep "Phase 12 platform console"); the Impeccable detector with zero
findings on `platform-catalog.tsx`; and the whole-repo gate — format:check, lint, typecheck, the
API and web production builds, and `git diff --check`.

### Recently closed (2026-09-05) — Phase 10 close-out

- **Phase 10 (Automation & Approvals) closed to the roadmap's "done and verified" bar, with named
  tracked debt.** The full gate is green: `format:check`, `eslint --max-warnings=0`, `tsc --noEmit`
  across every workspace, **117 unit tests**, **335 integration tests in 48 files** against the real
  Postgres/Redis/MinIO stack, migration drift zero in both directions **plus** the migration files
  replayed from scratch into a fresh shadow database matching the datamodel (the CI check), and
  both production builds. This was the first full-suite run since the §4–§7 test files landed.
- **Test coverage completed this session:** reminder-offset timing plus the paid/voided race
  (`reminders.int.test.ts`), scheduled-report filter/tenant/retention fidelity
  (`scheduled-report-delivery.int.test.ts`), scheduler sweep concurrency and `endDate`
  (`scheduler-sweep.int.test.ts`), and job-retry properties (`automation-jobs.int.test.ts`).
- **One production bug fixed:** BullMQ rejects custom job IDs containing `:` (its Redis key
  separator), so `event:${eventId}`/`schedule:${executionId}` would have thrown on first real use;
  all three enqueue sites now use `event-`/`schedule-` prefixes (full narrative in the 2026-09-04
  section below).
- **One test-infrastructure fix:** `harness.int.test.ts` asserted empty BullMQ queues, but the
  suite shares one Redis prefix and boots no consumers, so jobs enqueued by earlier-running files
  made the assertion order-dependent. The harness now drains both queues before asserting.
- **Environment quirk discovered:** on this machine `localhost` can resolve to IPv6 `::1` only,
  which the Docker services do not listen on — Prisma and `pg` both fail with `read ECONNRESET`
  while `127.0.0.1` works. The untracked `.env` files now pin `127.0.0.1` for every service URL;
  see §2.
- **Tracked debt carried forward** (each detailed in `docs/PHASE10_TODO.md`): the 10H approval
  edge-case tests; Quote's bespoke approval route not yet adapted into the policy engine; the
  deferred 10F refactors (export streaming, async `202` oversized-PDF export); the 10E recurring
  unification; two 10A contract schemas; 10C's `submitter role` condition and state-machine
  documentation; 10D's field-update action; and the 10I operator runbooks.

### Recently closed (2026-09-04) — Phase 10 automation implementation + verification pass

- **Phase 10 has substantial implementation across every milestone (10A–10G) and a green whole-repo
  verification pass, but is not done — see `docs/PHASE10_TODO.md`'s per-bullet `(partial: ...)` notes
  and `docs/PHASE10_TEST_PLAN.md` for exactly what's left.** Built: the transactional domain-event
  outbox with exponential backoff and a `Clock` DI seam; the shared `ScheduledJob` scheduler
  (misfire policies, DST-safe calendar math, now with optional `endDate`); the full approval engine
  (policy CRUD, submit/decide/cancel/detail/inbox/submitted-by-me, stale-target-version rejection,
  finalize gates on 8 of the 9 target types — `PAYMENT_MADE` has no finalize step to gate, it posts
  atomically at creation); workflow rules (CRUD, dry-run evaluation, per-rule run history, a
  registered-trigger allowlist shared with contracts, loop/idempotency guards); reminders and
  scheduled reports (both now fully editable, both correctly stop/pause rather than silently keep
  firing); automation task completion (previously creatable but unreadable/uncompletable by anyone);
  failed-job list/detail/retry; and a full web workspace for all of the above including edit forms.
- **This was the first time any of this code had ever been compiled, linted, or run.** Running the
  whole-repo gate (`format:check`, `eslint --max-warnings=0`, `tsc --noEmit`, 82 unit + 310
  integration tests, `prisma migrate deploy` + `migrate diff` for zero drift, both production
  builds) found and fixed real bugs: two crashing approval endpoints
  (`ApprovalTargetsService#submit`/`ApprovalsService#decide` ran `pg_advisory_xact_lock` — which
  returns `void` — through `$queryRaw` with no `::text` cast, unlike every other advisory-lock call
  site in the codebase; both would have thrown on first real use); several latent TS/lint errors
  (a `Namespace.Member`-as-type pattern this Prisma version's generated enums don't support, a
  BullMQ `Job<Union>` type-narrowing gap, an under-typed array destructure, unused imports,
  base-to-string lint violations); and a migration-authoring bug where six Phase 10 index names
  were long enough that PostgreSQL silently truncated them differently than Prisma expected —
  invisible until the migration was actually applied and diffed against a live database.
- **Every controller route from this phase, and several from before it, were missing from the
  authorization-boundary matrix** (`test/authorization-boundary.int.test.ts`) — the same class of gap
  Phase 6 hit (see 2026-09-02 entry below on why that matters). Fixed: 36 routes added, and the full
  eight-role permission matrix plus cross-tenant 404 check now passes for all of them.
- Two new integration tests prove the two highest-value safety properties end to end:
  `test/approvals.int.test.ts` passes the full build-spec §18.7 maker/approver scenario for invoices
  (maker cannot finalize → approver rejects with a comment → maker edits and resubmits → approver
  approves → issue succeeds → history is complete), plus self-approval denial, stale-target-version
  rejection, duplicate-pending rejection, and cancel; `test/outbox-atomicity.int.test.ts` proves
  commit-emits-once, rollback-emits-none, concurrent-claim-exactly-once, abandoned-lease recovery,
  and exponential backoff.

### Recently closed (2026-09-04) — Phase 9

- **Phase 9 (Reporting) shipped and verified (9A–9F).** `apps/api/src/reporting` provides one
  registry for 40 definitions across Financial, Receivables, Payables, Sales, Purchases, Tax,
  Inventory, Projects, and Audit. Every definition declares its source of truth and reconciliation
  rule; the engine applies date, basis, currency, project/tag, comparison, pagination, and source
  drill-down semantics. Ledger totals aggregate in SQL per D2.
- CSV and XLSX export stream; PDF uses the existing Playwright renderer and refuses exports over
  2,000 rows until Phase 10 provides its worker. `SavedReport` persists a user-scoped filter set
  with same-transaction audit evidence. `reports.manage` is the mutation permission.
- Web has `/reports`, `/reports/[reportKey]`, and `/reports/saved`, all behind the existing
  self-gating convention. The report library, shared filter/run/export/save shell, and source links
  are deliberately one component rather than nine report-specific screens.
- `reporting.int.test.ts` executes all 40 definitions and covers financial, AR/AP, inventory, and
  frozen-FX reconciliations. The full gate passed: 40 integration files / 298 tests, zero migration
  drift in both directions, and API + web production builds. Detail is in `PHASE9_TODO.md`.
- **Scheduled delivery remains Phase 10 work.** The repository still has no generalized domain
  event/scheduler, so Phase 9 intentionally exposes a registry/export seam rather than a second,
  one-off scheduler.

### Recently closed (2026-09-03)

- **Phase 8 (Globalization)** shipped and verified (8A–8E): versioned `CountryPack`/`TaxPack`/`DocumentRule`
  schema seeded from `jurisdiction-catalog.ts` per D3; `CountryPackStore` lazy-upserts with tier-locked seeding;
  pack CRUD + publish/deprecate behind a `PlatformAdminGuard`; derived compliance status (FULLY_REVIEWED /
  GENERIC_CONFIGURATION / UNSUPPORTED) surfaced per org; i18n string catalog in `packages/localization`;
  finalized transactions freeze the active pack version at issue time; `StructuredInvoice` canonical data
  artifact persisted in the issue transaction; compliance badge + language-fallback UI in org settings.
  `structured-invoice.int.test.ts` and `compliance-claims.int.test.ts` cover the round-trip, the
  unsupported-jurisdiction block, and the pin-freeze rule. `docs/PHASE8_TODO.md` has the detail.
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
  `_prisma_migrations` marker surgery, restored via `prisma migrate resolve --applied`). The one
  narrow exception: a migration that has _never_ been applied anywhere outside the current session
  (e.g. the Phase 10 migration, first applied to the dev DB during this session's own verification
  pass) can still be fixed in place, because there is no other environment whose applied-checksum
  could disagree with it — that's how the six truncated-index-name fixes above landed. If in doubt,
  add a new folder instead; the risk this rule guards against is real.
  PowerShell's `Out-File -Encoding utf8` writes a BOM Postgres rejects — strip it with
  `[System.IO.File]::WriteAllText(..., UTF8Encoding($false))`.
- Integration suite runs against `retailbooks_test` (auto-provisioned by `migrate deploy` from
  `test/support/database.ts`), NOT the dev `retailbooks` DB.
- **Run `npm run infra:up` first.** Other projects' Postgres containers are often running on this
  machine, which reads as "the DB is up" when RetailBooks' own containers are not.
- The boundary-matrix sweep legitimately needs ~60s (243 endpoints × 8 roles) and carries a 240s
  timeout — don't revert it to defaults. Raise it again when a phase adds a batch of controllers.
- On this machine, `localhost` can resolve to IPv6 `::1` only, while the Docker services publish
  IPv4 ports. Symptom: Prisma and raw `pg` fail with `read ECONNRESET` on `localhost` while
  `127.0.0.1` works (Docker Desktop restarts can flip which resolution wins). The untracked
  `.env` files pin `127.0.0.1` for `DATABASE_URL`, `REDIS_URL`, `S3_ENDPOINT`, and `SMTP_HOST` —
  keep it that way, and check this first when a fresh clone cannot reach the stack.
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
