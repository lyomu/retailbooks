# Phase 10 test plan — handover script

**Purpose:** a concrete, step-by-step script for finishing Milestone 10H (tests) of
`docs/PHASE10_TODO.md`. Everything in this file is scoped to what is genuinely still missing as of
2026-09-04 — it does not repeat what already passes. Read `docs/PHASE10_TODO.md` first for the full
feature inventory and the `(partial: ...)` notes on every bullet; this file exists to turn the 10H
gaps in that doc into an executable checklist.

Two integration tests already exist and are the reference pattern for everything below:
`apps/api/test/approvals.int.test.ts` and `apps/api/test/outbox-atomicity.int.test.ts`. Copy their
setup shape (harness, `beforeEach` org/user bootstrap, direct service injection via
`harness.app.get(SomeService)`) rather than inventing a new one.

## 0. Before you start

```bash
# From the repo root. Postgres/Redis/MinIO/Mailpit must be up.
npm run infra:up

# Apply any pending migrations to your dev DB (integration tests use a separate
# retailbooks_test DB, auto-provisioned by the global setup — this step is only for
# the dev DB used by `prisma migrate status`/`diff`).
cd apps/api && npx prisma migrate deploy

# Full baseline gate — run this now, and again after every change, to catch regressions early.
cd ../.. && npm run format:check && npm run lint && npm run typecheck
cd apps/api && npx vitest run                                      # 82 unit tests, DB-free
npx vitest run --config vitest.integration.config.ts               # 310 integration tests
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma --script               # must print "-- This is an empty migration."
cd ../.. && npm run build                                          # api + web production builds
```

All of the above passed clean as of this handover. If `format`/`lint`/`typecheck` fail on files you
have not touched, stop and investigate before writing new tests — something regressed.

**A note on `pg_advisory_xact_lock`:** if you add a new advisory-lock raw query anywhere, it must
carry a `::text AS locked` cast (`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text AS
locked`). Without the cast, Prisma cannot deserialize the `void` return type and the query throws at
runtime — this exact bug existed in two Phase 10 services and only surfaced once these tests ran for
the first time. `pg_try_advisory_xact_lock` (used by the outbox and scheduler claim logic) returns
`boolean` and does not need this cast; only the non-`try` variant does.

## 1. Unit tests (DB-free) — `apps/api/test/*.test.ts`

These run under `npx vitest run` (no `.int.` in the filename, no database). None of them exist yet.

### 1a. Schedule calculation, misfire policy, and DST/month-end/leap-day boundaries

File: `test/scheduler-calendar.test.ts`.

`nextOccurrence` is the only exported entry point (`apps/api/src/automation/scheduler.service.ts`).
`nextForMisfire`, `advanceOccurrence`, and the rest are private — either test them indirectly through
`nextOccurrence`'s behavior, or export them if a scenario genuinely needs the internal step (prefer
not exporting more than necessary).

Scenarios to cover, each asserting the returned UTC `Date` converts back to the expected
organization-local wall-clock time:

- `DAILY`, `WEEKLY` (with `weekday`), `MONTHLY` (with `dayOfMonth`), `QUARTERLY`, `ANNUALLY` each
  produce the correct next occurrence from a known `now`.
- Monthly/quarterly/annual `dayOfMonth: 31` clamps correctly in a 30-day month and in February
  (both leap and non-leap years) — `daysInMonth`'s `Math.min(schedule.dayOfMonth ?? now.day, ...)`
  clamp is the code path; assert the clamped day, not 31.
- A schedule whose computed next occurrence lands exactly on a DST transition in a real IANA zone
  (e.g. `America/New_York` on 2026-03-08, when the US springs forward) still produces a valid
  instant that reads back as the correct local wall-clock time — this is what `toUtc`/`localParts`'s
  round-trip exists to prove.
- `nextOccurrence` called with `now` already past today's local time advances to the _next_
  occurrence, not today's (the `toUtc(candidate, timeZone).getTime() <= now.getTime()` branch).

### 1b. Workflow condition operators

File: `test/workflow-conditions.test.ts`.

`conditionMatches` (`apps/api/src/automation/workflows.service.ts`) is private. Export it (add
`export` to the function declaration) before writing this file — it is pure and has no DI
dependencies, so exporting it is safe and does not change its behavior for `WorkflowsService`.

Cover every operator in `OPERATORS`/`workflowConditionSchema` (`equals`, `notEquals`, `exists`,
`greaterThan`, `lessThan`, `in`) against: a matching value, a non-matching value, a missing payload
field, and (for `greaterThan`/`lessThan`) a non-numeric payload value (must not throw, must return
`false` — the code guards with `typeof value === 'number'`).

### 1c. Domain event registry / payload versioning

File: extend `test/report-registry.test.ts`'s sibling pattern, or a new
`test/domain-event-registry.test.ts`.

`DOMAIN_EVENT_NAMES`/`domainEventNameSchema` now live in `packages/contracts/src/index.ts`. Assert:
`domainEventNameSchema.safeParse('invoice.issued').success === true`;
`domainEventNameSchema.safeParse('not.a.real.event').success === false`. This is what makes a
workflow rule's `trigger` field reject unregistered event names at both the DTO (`class-validator
@IsIn`) and service (`createWorkflowRuleSchema`/`updateWorkflowRuleSchema`) layers — a unit test on
the schema itself is enough; the DTO/service enforcement is already exercised by
`test/approvals.int.test.ts`-style integration coverage if you add a workflow-rule equivalent (see
§3 below).

## 2. Approval target-gate coverage for the remaining 8 target types

`test/approvals.int.test.ts` proves the full build-spec §18.7 scenario for `INVOICE` only. The other
eight (`QUOTE`, `SALES_ORDER`, `CREDIT_NOTE`, `PURCHASE_ORDER`, `BILL`, `PAYMENT_MADE`,
`INVENTORY_ADJUSTMENT`, `JOURNAL`) share the same generic `approval-targets.ts` snapshot/gate logic,
but each one's _finalize action_ is a different service method, and `PAYMENT_MADE` has no finalize
gate at all (documented reason: it posts atomically at creation, see `PHASE10_TODO.md` 10C).

Add one `describe` block per remaining target inside `test/approvals.int.test.ts` (reuse the file's
existing `owner`/`context`/`createMember`/`createSingleStepInvoicePolicy`-style helpers, generalized
to take a `targetType`). For each, the minimum useful assertion is: **submit blocks the finalize
action with the "awaiting approval" `ConflictException`, and approving unblocks it.** You do not need
to repeat the full reject/edit/resubmit/history cycle for all eight — that is already proven once for
`INVOICE`; the point of this pass is confirming the _gate itself_ is wired on each target's finalize
call site.

| targetType             | Draft/create, then required pre-finalize status transitions (in order)                                                                                                                   | Finalize method that should be gated  |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `QUOTE`                | `createDraft` → `submitForApproval` → `approve` → `send` → `accept` (reaches `ACCEPTED`)                                                                                                 | `QuotesService#convertToInvoice`      |
| `SALES_ORDER`          | `createDraft` → `approve` → `confirm` (reaches `CONFIRMED`)                                                                                                                              | `SalesOrdersService#convertToInvoice` |
| `CREDIT_NOTE`          | `createDraft` (starts `DRAFT`, no extra step)                                                                                                                                            | `CreditNotesService#issueCreditNote`  |
| `PURCHASE_ORDER`       | `createDraft` → `approve` (reaches `APPROVED`)                                                                                                                                           | `PurchaseOrdersService#issue`         |
| `BILL`                 | `createDraft` (starts `DRAFT`, no extra step)                                                                                                                                            | `BillsService#issueBill`              |
| `INVENTORY_ADJUSTMENT` | `createAdjustment` (starts `DRAFT`, no extra step)                                                                                                                                       | `InventoryService#postAdjustment`     |
| `JOURNAL`              | `createJournalDraft` (starts `DRAFT`, no extra step)                                                                                                                                     | `LedgerService#postJournal`           |
| `PAYMENT_MADE`         | — no finalize gate exists; skip, or add a test asserting `targets.submit()` still succeeds (freezes a snapshot) even though nothing ever checks it, to document the known gap explicitly | —                                     |

Get each target into its required pre-finalize status _before_ calling `targets.submit()`, matching
how `draftInvoice()` in the existing file needs no such dance only because Invoice's `issueInvoice`
accepts any `DRAFT`. Re-check each method's exact required `from` status against the service source
before writing the test — `SalesOrdersService#convertToInvoice`'s accepted statuses in particular are
worth confirming directly (its own `CONVERTIBLE_STATUSES` constant) rather than trusting this table
alone.

## 3. Workflow rule execution properties

New file: `test/workflow-rules.int.test.ts`. Inject `WorkflowsService` and `DomainEventsService`
directly (same pattern as `test/outbox-atomicity.int.test.ts`); you do not need HTTP.

- **Tenant-scoped:** create a rule with `trigger: 'invoice.issued'` in org A, emit a dispatched event
  with that name in org B (a second org from the same test), call `consumeEvent(eventId)`, and assert
  no `WorkflowRun`/`AutomationTask`/`Notification` was created for org A's rule. (`consumeEvent`
  already filters `where: { organizationId: event.organizationId, ... }` — this test proves it, it
  should not need a code change.)
- **Idempotent / loop-bounded:** create a rule, emit + dispatch one event, call `consumeEvent`
  **twice** with the same `eventId`, and assert exactly one `WorkflowRun` row exists (the
  `(ruleId, eventId)` unique constraint via `isUniqueViolation`). Separately, create 30 active rules
  on the same trigger and confirm `consumeEvent` only ever processes `MAX_RULES_PER_EVENT` (25) of
  them — assert via `WorkflowRun` count after one `consumeEvent` call.
- **Permission-aware / fails closed:** create a rule, then remove the creating user's organization
  membership (`organizationMember.update({ where: ..., data: { status: 'SUSPENDED' } })` or delete
  the row), emit + dispatch the trigger event, call `consumeEvent`, and assert the resulting
  `WorkflowRun.status` is `SKIPPED` with a reason mentioning access, not `FAILED` or `SUCCEEDED`.
- **Action failure captured, not silently lost:** give a rule a `CREATE_NOTIFICATION` action with a
  `recipientUserId` that does not exist as a member of the org (the DB foreign key or the
  `NotificationsService#create` lookup should fail), run it, and assert the `WorkflowRun` ends up
  `FAILED` with a non-empty `error` field (proves the "immutable version snapshot" + "redacted error
  capture" fix documented in 10D actually persists on real failures, not just the two paths already
  covered by reading the code).

## 4. Reminder timing

New file: `test/reminders.int.test.ts`. Inject `RemindersService`, `InvoicesService`, and
`SchedulerService`.

- Create a reminder policy with `offsets: [-3, 0, 7]`, issue an invoice with a known `dueDate`, call
  `scheduleInvoiceReminders` directly (or issue the invoice, which calls it internally — check
  `InvoicesService#issueInvoice`), and assert three `ScheduledJob` rows exist with `nextRunAt` equal
  to `dueDate ± offset` in the organization's timezone.
- Call `RemindersService#execute` for one of those jobs' execution while the invoice is still
  `ISSUED`/`PARTIALLY_PAID`/`OVERDUE` and assert an email was enqueued (check
  `EmailQueueService`/Mailpit, or assert the `ScheduledJobExecution.result` the way
  `scheduled-report-runner`-style tests do).
- **The race this bullet specifically asks for:** mark the invoice `PAID` (or void it) _between_
  scheduling the reminder and calling `execute()` for it, and assert `execute()` finishes as
  `SKIPPED`/completed-with-`skipped` (not an error, not an email) — this is the reload-and-check
  behavior documented in `PHASE10_TODO.md` 10E as the design's answer to "stop after payment or
  void."

## 5. Recurring scheduler concurrency (the Phase 10 scheduler layer specifically)

The four recurring modules already have their own pre-existing concurrent-trigger tests at the
_template_ level (e.g. `recurring-bills.int.test.ts`'s "concurrent double-trigger of runDueTemplates
produces exactly one child bill"). What has no test yet is the **`ScheduledJob`/`SchedulerService`
layer** Phase 10 added on top: does `SchedulerService#sweep()` called concurrently against the same
due `ScheduledJob` correctly claim it exactly once?

New file: `test/scheduler-sweep.int.test.ts`. Inject `SchedulerService` directly.

- Create a `ScheduledJob` (via `SchedulerService#createJob`) with `nextRunAt` in the past. Call
  `sweep()` twice concurrently (`Promise.all`). Assert exactly one `ScheduledJobExecution` row was
  created for it (the `pg_try_advisory_xact_lock` in `claimDueOccurrence` is what should guarantee
  this).
- Set a job's `schedule.endDate` to a date on or before its next occurrence, sweep it, and assert its
  `status` becomes `COMPLETED` and it is no longer picked up by a subsequent `sweep()` call — this is
  the end-date feature added this session (`pastEndDate` in `scheduler.service.ts`), and it has no
  test yet beyond having been read.

## 6. Scheduled report filter/tenant fidelity

New file: `test/scheduled-report-delivery.int.test.ts`, or extend `test/reporting.int.test.ts` if
that file already has reusable saved-report fixtures. Inject `ScheduledReportsService`,
`ScheduledReportRunnerService`, and whatever seeds a `SavedReport` (check `SavedReportsService` or
however `reporting.int.test.ts` creates one).

- Create a `SavedReport` with a specific filter (e.g. a date range or one customer), schedule it,
  then call `ScheduledReportRunnerService#execute` directly for the resulting execution. Fetch the
  generated artifact from `StorageService` (or intercept `ReportArtifactService#generate`'s call
  args) and assert it reflects the saved filter, not the full unfiltered report.
- Add a recipient who is a member of a _different_ organization (or not a member at all) directly via
  Prisma (bypassing `assertRecipients`, which would normally block this at creation time) and confirm
  `execute()`'s own `revalidateRecipients` excludes them from delivery — proving the tenant boundary
  holds even if a row somehow got past creation-time validation.
- Confirm the artifact-cleanup fix from this session: run `execute()` twice for the same
  `ScheduledReport` (two different executions/occurrences) and assert only the newest artifact key
  still exists in storage afterward (`StorageService#delete` should have removed the first one — see
  `ScheduledReportRunnerService#execute`'s retention comment).

## 7. Failed-job retry properties

New file: `test/automation-jobs.int.test.ts`. Inject `SchedulerService`.

- Create a `ScheduledJob` + a `ScheduledJobExecution` directly via Prisma with `status: 'FAILED'`,
  call `SchedulerService#retryExecution`, and assert: the row's `status` becomes `QUEUED`, `error` is
  cleared, and an `AuditEvent` row exists for `automation.job_execution_retried`.
- Call `retryExecution` a second time on the now-`QUEUED` (not `FAILED`) row and assert it rejects
  with the "Only failed executions can be retried" `ConflictException` — proves retry is not
  double-appliable.
- Cross-tenant: create the failed execution in org A, attempt `retryExecution` with org B's
  `OrganizationContext`, and assert `NotFoundException` (the query scopes on `organizationId`).

## 8. When you're done

Re-run the full gate from §0. Then, in `docs/PHASE10_TODO.md`:

- Tick each 10H bullet you've now covered, following the file's existing convention: a checked box
  gets a one-line parenthetical naming the test file/scenario that proves it. **Never check a box you
  have not verified** — `docs/HANDOVER.md` §3 records why this matters (it hid a real gap in Phase 6).
- Update the "Status" line at the top of `PHASE10_TODO.md` with the new checklist count.
- Only once every 10H bullet (and the two deliberately-deferred 10E/10F items, if you tackle them
  too) is checked, follow 10I's last bullet: roll Phase 10's status into `docs/BUILD_ROADMAP.md`,
  `docs/EXECUTION_PLAN.md`, and `docs/HANDOVER.md` in the same commit as whatever closes the gate —
  not as a follow-up step (see `docs/HANDOVER.md` §3, "Phase 5 drifted for two phases" for why).
