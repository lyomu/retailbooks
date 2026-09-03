# RetailBooks Phase 7 (Projects & Time) implementation checklist

Durable progress record for Phase 7: Projects & Time, sequenced by `docs/EXECUTION_PLAN.md`
Stage 5. This phase is being built under the user-confirmed rule **code first, tests in a following
pass** — a narrower version of the rule Phase 5 was built under, and one the execution plan's risk
R6 warns about, so the open test work is enumerated here rather than left implicit.
`docs/BUILD_ROADMAP.md`'s Phase 7 section is the rolled-up summary and is synced at close-out, in
the same commit, per the convention added in `HANDOVER.md` §3.

## Decisions carried in

**D1 — ledger dimensions: option (a), decided 2026-09-02** (`EXECUTION_PLAN.md`). `JournalLine`
gains nullable `projectId` and `tagId`. Existing rows are not backfilled — journals posted before
this migration predate projects, and a null says that honestly. The dimension is frozen inside the
posting transaction, at the same point the tax snapshot is frozen, so re-tagging a source document
can never restate an already-posted period. Profitability and Phase 9's dimension filters then read
from the ledger and reconcile to the profit and loss by construction rather than by a parallel
aggregation that can disagree.

Three consequences of D1 that only became visible while implementing it:

1. **`Tag` ships in Phase 7, not Phase 9.** Adding both dimension columns in one migration beats
   widening the largest table in the schema twice. The model is deliberately minimal — a name, a
   status, and the journal-line relation. Phase 9 makes it a report filter; Phase 7 gives it no CRUD
   surface, so there is no `tags.*` permission key yet.
2. **Invoice revenue is grouped by account _and_ project.** Grouping by account alone would collapse
   two projects sharing a revenue account into one journal line, and the dimension would have to be
   dropped or arbitrarily picked. `invoice-posting-rule.ts` now splits the line.
3. **Reversals carry the dimension forward.** A reversal that dropped it would leave the project's
   revenue standing with nothing to offset it, and profitability would overstate exactly the amount
   just reversed.

**`InvoiceLine.projectId` complements `projectTag`, it does not replace it.** Three sibling line
models still carry the free-text `projectTag`, and retiring it is a data-migration question rather
than a Phase 7 one. New writes set `projectId`, and that is what the posting rule stamps onto the
journal line.

## Milestone 7A — Schema and migration

- [x] `Project` (customer, name, dates, billing method, budget, status, manager)
- [x] `ProjectTask` (project, name, assignee, estimate, billable default, rate)
- [x] `TimeEntry` (date, project/task, user, hours, billable, rate, cost rate, note, status)
- [x] `ProjectExpense` (linked `Expense`, billable markup, invoiced-once guard column)
- [x] `ProjectBudget` (per task)
- [x] `Tag`, plus `projectId`/`tagId` on `JournalLine` per D1 — nullable, no backfill
- [x] `InvoiceLine.projectId` relation alongside the retained `projectTag`
- [x] Migration `20260902160000_add_phase7_projects_and_time`, applied with zero drift both
      directions
- [x] Migration `20260903090000_project_budget_task_required` — `project_budgets.task_id` becomes
      NOT NULL. The unique tuple `(project_id, task_id)` was not a real constraint while the column
      was nullable, because PostgreSQL treats NULLs as distinct: unlimited project-level rows could
      accumulate behind an index that looked like it forbade them. Project-level budget already
      lives on `Project` and needed no second home. Zero drift both directions.
- [x] Migration `20260903120000_expense_project_dimension` — `expenses.project_id`, nullable with no
      backfill, added during the test pass for the reason recorded under 7E. Zero drift both
      directions.

## Milestone 7B — Backend

- [x] Projects lifecycle Open → On Hold → Completed → Cancelled, with closed projects refusing new
      work and new time
- [x] Tasks inherit project-level access (no separate task permission)
- [x] Timesheets: submitted time is immutable until rejected or unlocked — the same immutability
      discipline posted journals get. Editing a _rejected_ entry returns it to draft, so an approver
      never re-approves something that changed underneath them.
- [x] Time approval by period, user, or project; approve/reject/unlock in bulk with a comment, each
      transition writing its own audit event
- [x] Project expenses: `ProjectExpense.expenseId` is unique, which makes project cost a partition
      of spend rather than a double count; `invoiceLineId` is unique and only ever moves from null
      to a value
- [x] Generate Invoice from approved unbilled time and expenses, through the existing
      `InvoicesService` — one tax resolution, one numbering sequence, one posting rule, one audit
      trail. The invoiced-once guard is a conditional update (`WHERE invoice_line_id IS NULL`) whose
      affected-row count is checked, so a losing concurrent request rolls back rather than
      double-billing.
- [x] The draft is created **inside** the claiming transaction, via `createDraft`'s new `externalTx`
      parameter. Created outside it, a losing race would leave a stray draft invoice standing for
      work that is still unbilled.
- [x] Profitability: revenue and cost from posted journal lines carrying the project's dimension;
      billed/unbilled hours, unbilled time and expense value, margin and margin percent
- [x] Idempotency key on the generate-invoice endpoint (roadmap non-negotiable)

## Milestone 7C — Permissions and contracts

- [x] `projects.*` permission keys in all four places — catalog keys array, catalog entries,
      `roles-catalog.ts`, contracts `permissionKeySchema` + group enum
- [x] `PROJECT_MANAGER` wired with a real permission set. It can scope projects, approve time, and
      bill the work, and can see and manage the invoice that billing produces — but not record
      payment against it. Raising a charge and settling it should not be the same pair of hands.
- [x] Contracts: Zod schemas, DTOs, response wrappers, and inferred types for all five entities plus
      `Tag`, profitability, and the billable preview

## Milestone 7D — Web workspace

- [x] Projects register: list, search, status filter, inline create/edit
- [x] Project detail with status transitions, profitability panel, and five sections
- [x] Tasks within project detail
- [x] Task budgets within project detail
- [x] Timesheet entry — manual, plus a stopwatch whose start instant lives in `localStorage` so a
      reload does not silently discard time someone is tracking. It rounds up to a hundredth of an
      hour, because `TimeEntry.hours` has two decimal places and the service rejects zero.
- [x] Time approval screen: filter by status, project, and period; bulk approve/reject/unlock with
      the decision comment required to reject
- [x] Project expenses screen (attribute, set markup, remove — never remove an invoiced one)
- [x] Generate-invoice-from-billables flow with per-line selection, draft-or-issue choice, and a
      client-generated idempotency key so a retried click cannot bill the same work twice
- [x] Profitability dashboard, both as a panel on project detail and as its own page
- [x] `Projects` nav group in `app-shell.tsx`; items unconditional, pages self-gate via
      `ForbiddenState`, per the Self-Gating Page Rule in `DESIGN.md`
- [x] `StatusBadge` tones extended for the Phase 7 statuses rather than forked

## Milestone 7E — Tests

Written in a following pass rather than alongside the code, per the rule this phase opened under.
The pass paid for itself: it found a defect that made the profitability screen wrong on every
project (see below).

- [x] **Boundary matrix `ENDPOINTS` entries for `ProjectsController`'s 25 routes.** Stage 2B.2's
      module-graph walk discovered the controller the moment it was registered and failed the
      "keeps the declared matrix synchronized" test until the declarations landed — exactly what
      2B.2 was built to do, and the first time it has fired on a phase it was written after. The
      eight-role sweep now covers 268 endpoints in ~37s, still well inside its 240s budget, so the
      timeout was left alone.
- [x] Approved billable time becomes invoiceable exactly once
- [x] A project expense cannot be invoiced twice, cannot be detached once invoiced, and cannot
      be re-marked non-billable to sneak a second link past the guard
- [x] Timesheet immutability after submit, and the rejected→draft edit path
- [x] Cross-module scenario 3 (build spec §18.3): project → approved time + expense → generate
      invoice → record payment → profitability and ledger reconcile
- [x] Dimension freezing: a re-tagged document does not restate a posted line; a reversal carries
      the dimension; two projects sharing a revenue account stay on separate journal lines
- [x] Check off Phase 14 cross-module scenario 3

`apps/api/test/projects.int.test.ts`, 14 tests.

### What the test pass found

**Project cost never reached the ledger, so margin equalled revenue on every project.** Only invoice
revenue lines carried the dimension; nothing wrote a dimensioned expense line, and
`profitability.costMinor` was therefore structurally `0`. The cause was ordering, not a missing
`if`: `linkExpense` requires an already-`POSTED` expense, and D1 forbids restating a posted line, so
attribution was always happening after the only moment it could be recorded.

The fix moves attribution earlier rather than relaxing the freeze:

- `Expense` gains a nullable `projectId` (migration `20260903120000_expense_project_dimension`),
  chosen while the expense is still a draft.
- Posting stamps it onto the expense debit only. The tax and payment legs are not this project's
  cost and are deliberately left undimensioned.
- A closed project stops accepting new cost, the way it already stopped accepting new time.
- `linkExpense` now refuses an expense whose frozen cost names a different project, and refuses one
  that posted with no project at all. Rebilling and costing must agree, because no later edit can
  move the posted line to make them agree afterwards.

Two smaller things the same pass surfaced:

- The locked-time message told the holder of an _approved_ entry to "reject" it, a transition that
  only accepts submitted time. Each locked state now names the one door out of itself.
- The four time transitions accepted `RequestMetadata` and dropped it, so their audit events were
  the only ones in the service missing an `ipHash`.

## Milestone 7F — Close-out

- [x] `docs/BUILD_ROADMAP.md` Phase 7 section rolled up **in the same commit** as the closing work,
      and Phase 14 cross-module scenario 3 checked off
- [x] `docs/HANDOVER.md` refreshed
- [x] Full CI sequence green end to end, including `npm run test:integration`

## Verification run so far

Everything below was run against the working tree at the end of the code-first pass:

- `npm run lint` — 0 errors
- `npm run format:check` — clean
- `npm run typecheck` — 7 workspaces clean
- `npm test` — 112 unit tests passing
- `npm run build` — API and web production builds, with all five new routes emitted
- Migration drift, both directions — no difference detected
- `npm run test:integration` — 36 files, 281 tests passing

Two notes for whoever runs the integration suite next, both about the same family of tests and
neither about Phase 7 code:

1. A mid-run failure of nine tests across seven files, all concurrency replays expecting six
   simultaneous successes, turned out to be the Postgres container being killed (exit 137) partway
   through a 343-second run. Check `docker ps -a` before reading the diff.
2. Even on a healthy container those replay tests flake occasionally under full-suite load — one
   did, in one of four full runs, and passed in isolation and on re-run. Six concurrent requests
   serialize behind one idempotency advisory lock, and a waiter can exceed its transaction timeout.
   The invariant they guard still held every time: one invoice, one key row. The timeouts were left
   alone rather than widened on a hunch, but if this becomes frequent it is worth measuring rather
   than re-running.
