# Handover Prompt — RetailBooks Global Accounting Platform

**Project:** `c:\Users\gmnyo\Desktop\Engineering projects\retailbooks` — a multi-tenant, global,
double-entry accounting & invoicing web platform (monorepo: `apps/api` NestJS, `apps/web` Next.js,
`packages/*` shared libs).

## 1. Orient yourself first

Before writing any code, read these in order:

1. `docs/BUILD_ROADMAP.md` — the master 14-phase task checklist. Its Phase 2 section is a rolled-up
   summary; `docs/PHASE2_TODO.md` (below) is the detailed, authoritative record.
2. `docs/PHASE2_TODO.md` — milestone-by-milestone record for Phase 2 (Sales). **Read it, but do not
   trust its checkboxes for 2E–2I** — see §2 below. It still shows those milestones unchecked even
   though the code exists, because the checklist update was deliberately deferred until verification
   passes (never happened yet).
3. `docs/PHASE1_TODO.md` and `docs/adr/000*` — Phase 1 detail and architecture decisions (tenancy,
   auth, roles/permissions, ledger, tax engine). Still load-bearing context for Phase 2 work.
4. `starter/global_accounting_platform_build_specification_v1.docx` and
   `starter/global_accounting_platform_master_blueprint.docx` — original specs, for exact
   field/rule/state definitions when a checklist item is ambiguous.
5. **This section's §3–5 below** — they capture the design decisions made while building 2E–2I, since
   the plan files used to design them (`~/.claude/plans/...`) get overwritten by each new planning
   session and no longer contain that reasoning. Read them before touching the credit note or
   recurring invoice code especially.

## 2. Current state (as of 2026-08-25)

**Phase 1 (Foundation) is fully complete**, verification-pass items intentionally deferred (unchanged
from before — see the last handover for detail, not repeated here).

**Phase 2 (Sales)**:

| Milestone | Status |
| --- | --- |
| 2A — Document numbering generalization | ✅ Done, committed |
| 2B — Customers/Contacts | ✅ Done, committed |
| 2C — Catalog (Items/Units/Categories) | ✅ Done, committed |
| 2D — Invoices (posting slice) | ✅ Done, committed |
| 2E — Payments Received + allocation | 🟡 **Coded, uncommitted, unverified** |
| 2F — Credit Notes | 🟡 **Coded, uncommitted, unverified** |
| 2G — Quotes + Sales Orders | 🟡 **Coded, uncommitted, unverified** |
| 2H — PDF generation + email delivery | 🟡 **Coded, uncommitted, unverified** |
| 2I — Recurring Invoices | 🟡 **Coded, uncommitted, unverified** |
| 2J — Customer Statements | ⬜ Not started — **your task** |
| 2K — Phase 2 verification pass (hard gate before Phase 6) | ⬜ Not started |

### The critical thing to understand: 2E–2I exist only in the working tree

Milestones 2E through 2I were built in one continuous session at the user's explicit direction to
**defer all verification** (`tsc`, `lint`, format, `npm test`, integration tests, migration drift
check, production build, browser walkthrough) until every milestone the user wanted in that push was
coded. That push stopped after 2I. **None of it has been migrated, generated, typechecked, linted,
tested, built, browser-verified, or committed.** `git log` still shows `0c0d28c` (2D's UI commit) as
HEAD; `git status` shows ~50 new/modified files, all uncommitted.

**The Prisma client is stale relative to `schema.prisma`.** Only one migration exists since 2D:
`apps/api/prisma/migrations/20260825042133_add_payments_received/` (2E's). Every model 2F–2I added
(`CreditNote`, `CreditNoteLine`, `CreditNoteAllocation`, `CreditNoteRefund`, `Quote`, `QuoteLine`,
`SalesOrder`, `SalesOrderLine`, `DocumentSnapshot`, `RecurringInvoiceTemplate`,
`RecurringInvoiceTemplateLine`, plus `sentAt` columns added to `CreditNote`/`Quote`) is only in
`schema.prisma` — **no migration has been generated for any of it, and `npx prisma generate` hasn't
been re-run either.** Nothing will typecheck until you run migrate+generate. This is step 1 below, not
optional.

New runtime dependencies were added for 2H and installed (`@aws-sdk/client-s3`,
`@aws-sdk/s3-request-presigner`, `playwright`), and the Playwright Chromium binary was downloaded
(`npx playwright install chromium` — confirmed cached under `~/AppData/Local/ms-playwright` already,
should be a no-op if you re-run it). **None of the PDF-render → S3-upload → email-attach flow has ever
actually executed** — it's been written against the spec and this session's understanding of the
existing patterns, not run once. Same for the recurring-invoice sweep logic. Treat all of 2E–2I as
"looks right, unverified" — 2E is the one exception: its money-invariant tests *were* actually run
during that milestone (see §4, they caught a real bug), everything after that was written but never
executed.

### Files touched (for your own review before running anything)

Modified: `apps/api/package.json`, `apps/api/prisma/schema.prisma`, `apps/api/src/jobs/email-job.ts`,
`apps/api/src/organizations/{ledger-starter-chart,permission-catalog,roles-catalog}.ts`,
`apps/api/src/sales/{invoices.controller,invoices.service,sales.module}.ts`,
`apps/api/test/{authorization-boundary.int.test,permission-resolution.test,system-account-keys.test}.ts`,
`apps/web/src/components/{app-shell,invoices-workbench}.tsx`, `packages/contracts/src/index.ts`.

New: `apps/api/src/sales/{payments,credit-notes,quotes,sales-orders,recurring-invoices}.{dto,service,controller}.ts`,
`apps/api/src/sales/{document-rendering.service,pdf-templates}.ts`, `apps/api/src/storage/**`,
`apps/api/test/{payments,credit-notes,quotes-and-orders,document-rendering,recurring-invoices}.int.test.ts`,
`apps/web/src/components/{payments,credit-notes,quotes,sales-orders,recurring-invoices}-workbench.tsx`,
`apps/web/src/app/{payments,credit-notes,quotes,sales-orders,recurring-invoices}/**`,
`apps/api/prisma/migrations/20260825042133_add_payments_received/`.

## 3. Design decisions you need to know before touching this code

These were genuine ambiguities in `docs/PHASE2_TODO.md`'s checklists, resolved by asking the user
directly. They're not written down anywhere else now that the planning-session plan files have been
overwritten — this is the only record.

- **Payments (2E) allocation invariant — a real bug was caught and fixed here.** The original guard
  compared `existingAllocationFromThisPayment + requested` against `invoice.balanceMinor`. That
  double-counts: `balanceMinor` is already net of *every* prior allocation against that invoice
  (from any payment), so re-adding this payment's own prior allocation on top double-subtracts it. Fixed
  to just `requested > invoice.balanceMinor`. This was caught by the integration test suite actually
  running (2E is the one milestone where that happened) — **if you find the same
  `existingAllocations`-style pattern anywhere in the credit note allocate code, it's already correct**
  (written after this lesson), but double-check it when you finally run 2F's tests for real.
- **Credit Notes (2F) issue into `customer_credit`, not directly into `accounts_receivable`.** The
  checklist says two things that can't both be literally true at once: "issue posts... credit AR" *and*
  "add a `customer_credit` account... for the refund path." If issue credited AR directly, there'd be
  nothing in `customer_credit` for a later refund to draw down. Resolution: issue credits
  `customer_credit` (a liability holding account); **allocation** (`DR customer_credit, CR
  accounts_receivable`, one journal *per invoice per call*) and **refund** (`DR customer_credit, CR
  bank_default`) are what actually move value out of it. This is a deliberate, documented deviation
  from the checklist's literal wording — see the doc comment at the top of
  `apps/api/src/sales/credit-notes.service.ts`.
- **Credit note refund was built** (not deferred) — the user explicitly asked for it. It's a real
  second/third+ posting per credit note (`CreditNoteRefund` is a per-event table, same shape as
  `CreditNoteAllocation`), not a single field.
- **`CreditNoteStatus.APPLIED`** only fires when `remainingMinor` hits zero via allocation;
  `REFUNDED` only when it hits zero via refund. While partially consumed, status stays `ISSUED` — there's
  no `PARTIALLY_APPLIED` value in the enum.
- **Quotes/Sales Orders (2G) convert-to-invoice** is a two-phase, non-atomic call
  (`InvoicesService#createDraft` doesn't accept an external transaction). Worst-case failure is an
  orphaned unlinked DRAFT invoice, never a ledger inconsistency, since nothing here ever posts.
  SalesOrder's `SalesOrderStatus` has **no `CONVERTED` value** — converting only sets
  `convertedInvoiceId` and leaves fulfillment status untouched, unlike Quote.
- **PDF/email (2H)**: Playwright renders **synchronously inside the API request** (not offloaded to
  the worker process) — the render and the `DocumentSnapshot` cache row land together, avoiding
  distributed two-phase state. This means the *main API container* needs the Chromium binary too, not
  just the worker (`apps/api/src/worker.ts`'s process). The PDF attachment is delivered via a
  **pre-signed S3 URL** in the BullMQ job payload (`EmailDeliveryJob.attachments[].path`), not embedded
  bytes — keeps Redis job payloads small; nodemailer streams it at send time.
- **Quote's `send()` action was pre-existing (2G, status-only APPROVED→SENT) and got enhanced in
  2H**, not duplicated into a second endpoint. Its status guard now accepts **both** `APPROVED` and
  `SENT` as valid starting states — if it only accepted `APPROVED`, a quote could never be re-sent once
  first sent. Double-check this guard specifically; it's an easy regression to reintroduce if the method
  gets refactored.
- **Recurring invoices (2I) have no cron.** No scheduling library exists in the stack and adding one
  was ruled out of scope. `runDueTemplates()` is exposed as a permission-gated
  `POST .../recurring-invoices/run-due` endpoint meant for an external cron or manual trigger — there's
  a "Run due templates now" button in the UI for exactly this reason. Documented as a deferral, not an
  oversight.
- **SALES role asymmetry**, applied consistently across every milestone this session: SALES gets the
  forward-workflow permission keys (`manage`/`issue`/`approve`(quotes-and-orders only where it's a
  distinct forward step)/`convert`/`record`/`send`) but never the money-moving or reversing ones
  (`void`, `allocate`, `refund` on credit notes; `allocate` on payments; `approve` is withheld from
  SALES specifically on quotes/orders, reserved for ADMIN/ACCOUNTANT as a checker step). If you add
  more Sales permissions, match this pattern rather than re-deriving it.

## 4. ⚠️ A known-likely bug to check first: `advanceCadence`'s month/year arithmetic

`apps/api/src/sales/recurring-invoices.service.ts`'s `advanceCadence()` uses
`Date.prototype.setUTCMonth`/`setUTCFullYear` directly:

```ts
case 'MONTHLY':
  next.setUTCMonth(next.getUTCMonth() + 1);
```

JavaScript's `Date` **overflows** when the target month is shorter than the source day-of-month — e.g.
`2026-01-31` advanced by one month becomes `2026-03-03`, not clamped to `2026-02-28`. The same applies
to `ANNUALLY` landing on Feb 29 in a non-leap year. **This was never caught because the integration
test in `recurring-invoices.int.test.ts` uses `startDate: '2026-01-15'`** — a day that doesn't hit any
month-end edge case. Write a test with a month-end/leap-day start date before trusting this in
production; fix by clamping to the last valid day of the target month if it overflowed.

## 5. Immediate next step: Milestone 2J — Customer Statements

Per `docs/PHASE2_TODO.md`:

- `statements.service.ts#getStatement(orgId, contactId, asOf)` — **read-only**, derived from
  `Invoice`/`PaymentReceived`/`CreditNote`, no new mutating model. Since 2E/2F now actually exist
  (they didn't when this checklist line was first written relative to 2D), the statement should surface
  a proper running ledger for the contact: issued invoices, payments received and their allocations,
  credit notes issued/applied/refunded, and a running balance — not just invoice totals in isolation.
  Use plan mode for this (same pattern as every other milestone this session) since the exact shape of
  "a statement" (transaction list vs. summary vs. both, date-range vs. as-of-single-date) is a real
  design choice worth getting user sign-off on before coding.
- New permission key `sales.statements.view` (SALES/ADMIN/ACCOUNTANT/VIEWER — this one's read-only for
  everyone who can already see the underlying documents, no asymmetry needed).
- UI: `apps/web/src/app/customers/[id]/statement` (or similar — confirm with the user, the checklist
  says "or similar").
- Test: statement total reconciles exactly to `sum(Invoice.balanceMinor)` for the contact.

**2J needs no schema migration** (explicitly "no new mutating model") — you can build and typecheck it
against a freshly-migrated schema without it adding to the migration you're about to write for 2F–2I.

## 6. Then: the full deferred verification pass across 2E–2J

Once 2J is coded, run this once, covering everything since 2D. **Do not skip straight to `npm test`** —
the Prisma client is stale, nothing will compile.

1. **Migration first.** `cd apps/api && npx prisma migrate dev --name add_credit_notes_quotes_orders_documents_recurring`
   (pick your own name; this single command should pick up every schema change since 2E's migration —
   confirm the generated SQL touches exactly the tables listed in §2, no more, no less). Then
   `npx prisma generate` if migrate doesn't already trigger it.
   - **Known Windows gotcha, hit repeatedly this session**: `npx prisma generate` fails with
     `EPERM: ... query_engine-windows.dll.node` if any `nest start --watch` dev process (yours or a
     peer session's) is running and holds the query-engine DLL open. Check
     `Get-CimInstance Win32_Process -Filter "Name='node.exe'"` (PowerShell) for `retailbooks` processes
     before assuming this is a real failure. **Ask the user before killing anything** — other sessions
     may be actively using their dev servers; this happened twice this session and both times required
     explicit user sign-off, once because killing the first suspected process caused a
     `nest start --watch` parent to immediately respawn a fresh one holding the same lock.
2. `npx tsc --noEmit` in `apps/api` and `apps/web`, then `npm run typecheck` at root.
3. `npm run lint` at root.
4. `npx prettier --write <changed files>`, then `npm run format:check`.
5. `npm test` and `npm run test:integration` in `apps/api` (infra up: `npm run infra:up` — Postgres,
   Redis, MinIO, Mailpit). **New for this pass**: MinIO must actually be reachable for
   `document-rendering.int.test.ts` (it calls `StorageService.ensureBucket()` for real — first call
   creates the bucket if missing) and Playwright's Chromium must launch successfully for the same test
   and `recurring-invoices.int.test.ts`'s `autoSend` case.
6. Migration drift check (the three-command `docker exec` + `prisma migrate diff --exit-code` sequence
   from the previous handover — unchanged).
7. `npm run build` at root (both apps, production mode).
8. **Browser golden path** — this is the first time any of 2E–2J gets human eyes on it:
   - Payments: record a payment, allocate it across two invoices, confirm status flips.
   - Credit Notes: issue one, allocate part of it, refund the remainder, confirm `remainingMinor`
     reaches zero and status lands on `APPLIED`/`REFUNDED` correctly depending on order of operations.
   - Quotes: full state machine through to convert-to-invoice; confirm the converted invoice's totals
     match exactly.
   - Sales Orders: same, confirm convert doesn't change fulfillment status.
   - Send: issue an invoice, click Send, **check Mailpit** (`http://localhost:58025`) for the email
     and confirm the PDF attachment actually opens and looks right. Click Send again, confirm the
     `DocumentSnapshot` row didn't duplicate (check the DB) but a second email arrived.
   - Recurring Invoices: create a template with a past `startDate`, click "Run due templates now",
     confirm an invoice was generated and `nextRunDate` advanced.
   - Statements (2J): pull up a customer with invoices/payments/credit notes and confirm the numbers
     reconcile.
9. Update `docs/PHASE2_TODO.md`: check off 2E through however far this pass actually confirms (don't
   check off a milestone whose browser test you skipped), with implementation notes in the established
   style. Sync `docs/BUILD_ROADMAP.md`'s Phase 2 rollup.
10. Commit. Given the size, consider one commit per milestone group (2E; 2F+2G; 2H+2I; 2J) rather than
    one giant commit, matching this project's existing one-commit-per-milestone history — check with
    the user on granularity before pushing anything.

Only after all of that is 2K (the cross-module acceptance/consolidation pass) realistically startable —
it explicitly assumes 2E–2J are individually verified already.

## 7. Non-negotiable conventions

(Full list in `docs/BUILD_ROADMAP.md`'s "Platform-wide contracts" section — unchanged from prior
handovers, not repeated here. The short version, reconfirmed by this session's work: every tenant table
carries `organization_id`; money is always `BigInt` minor units; posted ledger records are immutable,
corrections are reversals; every new permission key lands in three places
[`permission-catalog.ts`, `roles-catalog.ts`, `packages/contracts/src/index.ts`'s
`permissionKeySchema`]; every new controller needs an `authorization-boundary.int.test.ts` `ENDPOINTS`
entry or its own sync-check test fails loudly.)

## 8. Known environment quirks worth knowing before you hit them

- **Prisma client generation EPERM on Windows** — see §6 step 1. Ask before killing processes.
- **Web production build bakes `NEXT_PUBLIC_API_URL` in at build time** — unchanged from prior
  handovers; rebuild with normal env before resuming ordinary local dev if you've touched the E2E
  harness's target port.
- **The Playwright e2e harness** (`apps/web/e2e/prepare.mjs`) still fails at `clearAuthRateLimits` —
  pre-existing, unrelated, not yet root-caused. Manual browser verification against the plain dev
  servers is still the working path.
- **A long-lived local dev database's demo-org roles go stale** relative to `roles-catalog.ts` as new
  permission keys are added between sessions (roles are snapshotted once at org-creation time). If a
  demo user hits an unexpected `ForbiddenState` on a page whose permission key was added in 2E–2I,
  that's the cause — reconcile `role_permissions` rows for that org, don't reset the database.
