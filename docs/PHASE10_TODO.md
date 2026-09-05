# RetailBooks Phase 10 (Automation & Approvals) implementation plan

Durable progress record for Phase 10, sequenced by `docs/EXECUTION_PLAN.md` Stage 8.
`docs/BUILD_ROADMAP.md` remains the scope authority. This file turns that scope into implementation
order, architectural decisions, acceptance gates, and a final verification checklist.

**Status:** closed with tracked debt (2026-09-05), 64/76 checklist items done. Milestones 10A
through 10G are implemented and verified; 10H's remaining gap and 10I's operator docs are named
debt, not silent omissions. Twelve bullets below stay unchecked, each carrying its own
`(partial: ...)` or "deliberately not attempted" note: the two 10F refactors (export streaming,
async `202` oversized-PDF export), the two 10E recurring-unification items (`runDueTemplates`
compatibility adapters, projecting recurring API state from the shared job), the Quote
approval-route adapter (10C), two 10A contract schemas (`ReminderPolicy`, `ScheduledJobExecution`),
10C's `submitter role` condition and per-target state-machine documentation, 10D's field-update
safe action, the 10H approval edge-case tests, and the two 10I operator-facing documents.

Everything above has now been verified for real: `format:check`, `eslint --max-warnings=0`,
`tsc --noEmit` across every workspace, the 117-test DB-free unit suite, the 335-test integration
suite against a real Postgres/Redis/MinIO stack, `prisma migrate deploy` + `migrate diff` showing
zero schema drift, and production builds for both API and web all pass. That pass caught and fixed
real bugs -- two crashing `pg_advisory_xact_lock` calls, several latent TS/lint errors from code that
had never once been compiled, a migration index-naming mismatch, and (added by 10H §5/§7's tests) a
BullMQ job-ID bug where `sweep()` and manual retries used `schedule:<executionId>`/`event:<eventId>`
custom job IDs containing `:` -- BullMQ's Redis key separator -- so every enqueue threw
("Custom Id cannot contain :") and executions were stuck with `sweep()` silently recording the error
instead of enqueueing; all job IDs now use `schedule-`/`event-` prefixes. 10H is now substantially
covered (see "Milestone 10H — Tests and acceptance"): the approval maker-checker scenario (build
spec §18.7) and outbox atomicity were already proven; this session's work added per-target finalize
gate coverage for all eight non-INVOICE approval targets (including the documented `PAYMENT_MADE`
no-gate gap), workflow rule execution properties, reminder-offset timing plus the paid/voided race,
scheduler sweep concurrency and `endDate`, scheduled-report filter/tenant/retention fidelity, and
job-retry properties -- see each bullet's parenthetical for the exact file. Closing the gate also surfaced one
test-infrastructure bug: `harness.int.test.ts` asserted empty BullMQ queues, but the suite shares
one Redis prefix and boots no consumers, so the first full-suite run after the §4–§7 files landed
failed on jobs legitimately enqueued by earlier-running files; the harness now drains both queues
before asserting. One 10H bullet remains open (multi-level ordering / criteria boundaries /
concurrent decisions / mid-flight policy edits / revoked permissions), alongside the
deliberately-deferred 10E/10F items and 10I's operator docs -- all carried forward as named debt in
`BUILD_ROADMAP.md`, `EXECUTION_PLAN.md`, and `HANDOVER.md`.

## Scope and boundaries

Phase 10 delivers policy-driven approvals, safe workflow automation, due-date reminders, one shared
recurring/scheduling runtime, notifications, scheduled report delivery, and organization-scoped job
operations. It reuses the existing BullMQ worker, email delivery abstraction, object storage,
Phase 9 report registry/export engine, audit writer, permissions, and module-specific transaction
services.

The following are deliberately outside this phase:

- customer-portal approval or delivery surfaces (Phase 11)
- global platform queue administration across tenants (Phase 12)
- AI-authored or autonomous financial actions (Phase 13)
- arbitrary user code, arbitrary SQL conditions, webhooks, payment links, and payment gateways
- autonomous issue, post, approve, pay, void, reverse, reconcile, or period-unlock rule actions

## Decisions locked before implementation

### D4 — Domain events use a transactional outbox

Business services write a typed `DomainEventOutbox` row in the same PostgreSQL transaction as the
state change. A worker relay claims rows with a lease/`FOR UPDATE SKIP LOCKED`, publishes typed jobs
to BullMQ using the outbox ID as the job ID, and records dispatch state. Consumers record an
idempotency key before producing side effects. `AuditEvent` remains append-only evidence and is not
used as a queue. This prevents both lost events and accidental replay of business history.

The initial event catalog is `invoice.issued`, `invoice.voided`, `payment.recorded`, `bill.posted`,
`journal.posted`, `stock.moved`, and `reconciliation.completed`, plus the approval, reminder,
schedule, notification, and job lifecycle events introduced here. Event payloads contain stable IDs
and immutable routing facts, not complete mutable records; consumers reload tenant-scoped state.

### D5 — One scheduler owns time

`ScheduledJob` is the single source of truth for next-run time, timezone, handler, payload, misfire
policy, activation state, and retry policy. The worker polls due rows and enqueues occurrences; HTTP
requests never perform a global due sweep. The four existing recurring template models retain their
business content but stop owning schedule progression. Their schedule fields are migrated into
`ScheduledJob` and exposed through compatibility projections until a later cleanup migration.

Schedules are expressed as validated calendar data, not arbitrary cron text. Business dates are
evaluated in the organization's IANA timezone and persisted as UTC instants. Financial recurring
jobs default to `CATCH_UP`; reminders and scheduled reports default to `RUN_ONCE` after downtime.

### D6 — Approval requests freeze policy and target context

An active policy is resolved deterministically when a document is submitted. The resulting request
stores the target type/ID/version, material amount/currency/context, and a snapshot of every approval
step. Later policy edits cannot rewrite an in-flight chain. Approval decisions are append-only.

A target-adapter registry owns submit, lock, reject, resubmit, approve, and final issue/post gates for
quotes, sales orders, invoices, credit notes, purchase orders, bills, payments made, inventory
adjustments, and journals. Existing target-specific approval permissions remain authoritative;
assignment to a step never grants permission. Self-approval is denied by default. A stale target
version invalidates the decision rather than approving changed content.

### D7 — Workflow automation is declarative and allowlisted

Rules use versioned trigger, condition, and action schemas from registries in shared contracts. No
expression evaluation, arbitrary JavaScript, or SQL is accepted. Phase 10 actions are limited to
notifications, creation of an `AutomationTask`, and explicitly registered non-financial field
updates on mutable records. Rule creation requires the permissions for every configured action;
execution revalidates authorization and tenant membership so a rule cannot preserve revoked access.

Event envelopes carry causation IDs, correlation IDs, depth, and applied-rule IDs. Re-entry is
bounded and a rule cannot act twice on the same event, preventing loops and fan-out storms.

### D8 — Background work has explicit identity and tenant scope

Every scheduled job stores the organization and creating/authorizing user. Worker actions write audit
events with the initiating user where still valid and system-execution metadata; system-initiated
cancellation/dispatch can use a null audit actor. Every execution, artifact, retry, and notification
is organization-scoped. Worker handlers revalidate the target organization before reading data or
performing side effects.

### D9 — Scheduled reports reuse Phase 9

A scheduled report references a `SavedReport`, selected format, active organization-member
recipients, and a `ScheduledJob`. Execution revalidates the report definition, filters, membership,
and current report permission. It calls the Phase 9 report/export engine, streams the artifact to
object storage, and passes a short-lived pre-signed URL to the existing email attachment mechanism.
No second report query or rendering implementation is allowed.

## Milestone 10A — Contracts, permissions, schema, and migration

- [ ] Add shared enums and discriminated Zod contracts for event envelopes, approval targets and
      decisions, workflow triggers/conditions/actions, schedule definitions, job executions,
      notifications, reminders, and scheduled reports
      (partial: `domainEventSchema`, approval/workflow/schedule/notification schemas exist in
      `packages/contracts`; no `ReminderPolicy` or `ScheduledJobExecution` contract schema yet)
- [x] Add permission keys and role defaults for approval inbox/policy management, workflow rules,
      schedules/reminders, notification preferences, scheduled reports, and tenant job retry access
- [x] Add `DomainEventOutbox` with organization, event name/version, aggregate identity, payload,
      causation/correlation metadata, availability, lease, attempt, dispatched, and failure fields
- [x] Add relational approval models: `ApprovalPolicy`, ordered `ApprovalPolicyStep`,
      `ApprovalRequest`, frozen `ApprovalRequestStep`, and append-only `ApprovalDecision`
- [x] Add `WorkflowRule`, `WorkflowRun`, and `AutomationTask`
- [x] Add `ScheduledJob` and append-only `ScheduledJobExecution` with a unique occurrence key
- [x] Add `ReminderPolicy`, `ScheduledReport`, `Notification`, and `NotificationPreference`
- [x] Add organization/user relations, tenant-prefixed indexes, active/due-job indexes, inbox
      indexes, and uniqueness constraints for event consumption and schedule occurrences
- [x] Add one new migration; backfill one scheduled job for every recurring invoice, bill, expense,
      and journal template without editing any applied migration
- [x] Prove zero migration drift in both directions using the documented shadow-database procedure
      (run at close-out, 2026-09-05: `prisma migrate diff` between the live dev database and the
      datamodel prints "This is an empty migration." in both directions, and
      `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel` replaying the
      migration files from scratch into a freshly created `retailbooks_shadow` database exits 0
      ("No difference detected.") -- the same check `.github/workflows/ci.yml` runs)

## Milestone 10B — Durable event and worker foundation

- [x] Create a versioned domain-event registry; reject unregistered event names or payload versions
- [x] Provide a transaction-aware outbox writer that domain services call inside their existing
      Prisma transactions
- [x] Emit the seven required accounting events from the same transaction as each successful state
      change; failed/rolled-back changes emit nothing
- [x] Add an outbox relay to the existing worker with lease recovery, bounded batches, exponential
      retry, structured logs, metrics, and graceful shutdown (`release()` now backs off
      exponentially per the row's own `attempts`, capped at 5 minutes; "metrics" is a structured
      per-drain-cycle log line (claimed/dispatched/failed/durationMs) rather than a metrics-library
      counter, since nothing in this codebase exports metrics any other way and the worker process
      has no HTTP surface to scrape from)
- [x] Add the automation BullMQ queue and typed dispatcher; use stable job IDs and consumer
      idempotency keys so publish and consume are both replay-safe
- [x] Extend readiness/health with outbox backlog age, automation queue depth, failed count, and
      worker availability without exposing cross-tenant job data (`HealthService` now aggregates the
      oldest-pending-row age and the automation queue's own counts; "worker availability" is inferred
      from that backlog age, the only unauthenticated signal available without an explicit heartbeat)
- [x] Add clock and queue ports so due-time, retry, and replay behavior are deterministic in tests
      (a `CLOCK`-injected `Clock` port, provided once in `DomainEventsModule` and reused by
      `AutomationModule`/`AutomationWorkerModule`, backs every timestamp in `SchedulerService`,
      `DomainEventsService`, and `OutboxRelayService`; `AutomationQueueService` was already an
      injectable seam a test can stub, as `health.service.test.ts` already does. Scoped to the
      due-time/retry/replay path the bullet names — a few incidental `new Date()` calls elsewhere in
      `reminders.service.ts`/`scheduled-reports.service.ts` for one-off creation/completion
      timestamps were deliberately left alone)

## Milestone 10C — Approval policy engine and target gates

- [ ] Implement deterministic policy resolution for no approval, simple approval, ordered
      multi-level approval, and criteria-based approval by amount, creator, submitter role, and
      target tag/project dimension
      (partial: amount min/max, submitter user ID, tag ID, and project ID conditions all resolve
      deterministically by priority; there is no "submitter role" condition, and tag/project
      conditions can never match today because none of the nine target types carries a header-level
      tag or project column — see `approval-targets.ts`'s doc comment)
- [x] Reject ambiguous active policies at activation time; define priority and most-specific-match
      ordering in one policy resolver
- [x] Implement policy CRUD/versioning and activate/deactivate flows with same-transaction audits
- [ ] Implement the target-adapter registry for all nine roadmap target types, documenting each
      target's editable, pending, rejected, approved, issued/posted, and terminal behavior
      (partial: `approval-targets.ts` resolves a live snapshot for all nine types and gates
      finalization for eight of them; there is no formal per-type state-machine documentation)
- [x] Implement submit, approve, reject-with-comment, resubmit, cancel, detail/history, submitter
      queue, and assigned-approver inbox services and endpoints (resubmit has no distinct endpoint:
      a cancelled or rejected request no longer counts as pending, so re-submitting the target
      through `ApprovalTargetsService#submit` freezes a fresh snapshot and starts a new request —
      see the doc comment on `ApprovalsService#cancel`)
- [x] Freeze step assignments and target material context on submit; reject decisions against stale
      target versions, changed totals, inactive memberships, or missing target-specific permission
- [x] Enforce maker-checker separation and ordered steps; one step cannot be decided twice under
      concurrent requests
- [x] Add an approval gate to every target's existing issue/post/finalize path so direct endpoints
      cannot bypass a required policy (eight of nine targets have such a path; `PAYMENT_MADE` posts
      atomically at creation with no separate finalize step to gate)
- [ ] Preserve existing module-specific approval routes as thin compatibility adapters where needed;
      all decisions and history must flow through the new engine
      (not done: Quote's own bespoke submit/approve flow (`sales.quotes.approve`) still runs
      entirely independently of the new policy engine, not as an adapter into it)
- [x] Emit and audit submitted, approved-step, rejected, resubmitted, cancelled, and fully-approved
      lifecycle events (submitted/step-approved/rejected/completed/cancelled all emit and audit;
      "resubmitted" is not a distinct event since resubmit is just a new `approval.submitted`)

## Milestone 10D — Workflow rules, tasks, and notifications

- [x] Implement registries for supported triggers, typed conditions, and safe actions, including a
      human-readable preview of what a rule can do (`trigger` is now validated against the shared
      `DOMAIN_EVENT_NAMES` registry in `@retailbooks/contracts` at both the DTO and zod-schema layer,
      instead of an unvalidated free string a rule could silently never match against; "preview" is
      the new dry-run evaluator below, which is a stronger guarantee than a static sentence since it
      shows a real match against a real sample payload)
- [x] Implement rule CRUD, validation, activation/deactivation, dry-run evaluation, and immutable
      version snapshots for executions (`WorkflowsService#updateRule` added, gated the same way
      `ApprovalsService#updatePolicy` gates edits -- not while `ACTIVE`; `#dryRun` evaluates
      conditions and previews interpolated actions against a caller-supplied payload with no
      persistence and no side effects; every `WorkflowRun`'s `result` now carries the rule's
      `version` at execution time, so a later edit cannot retroactively change what a historical run
      is understood to have done. No hard delete, matching `ApprovalPolicy`'s own no-delete pattern)
- [x] Implement condition evaluation with explicit operators per field type and no arbitrary code or
      data access
- [ ] Implement safe actions: create in-app/email notification, create `AutomationTask`, and execute
      only registered non-financial field updates on mutable targets
      (partial: `CREATE_NOTIFICATION` now sends both an in-app row and an email, each independently
      gated by the recipient's preference; `CREATE_TASK` exists and its tasks can now be listed and
      completed via `AutomationTasksController`. There is still no third action type for a registered
      non-financial field update on a mutable target -- a real, deliberately-scoped-out capability:
      it needs its own per-entity-type allowlist of updatable fields, which is a meaningfully sized
      new subsystem on its own, not a small addition to this pass)
- [x] Enforce action authorization at create/activate and execution time; fail closed when the
      authorizing membership or permission no longer exists
- [x] Implement loop protection, per-event/rule idempotency, bounded fan-out, run history, and
      redacted error capture (`WorkflowRun` is now created and committed before actions run, so an
      action failure rolls back only the actions and `runRule` writes a `FAILED` row with a
      message-only, URL-scrubbed, length-capped error via `redactedErrorMessage`)
- [x] Implement notification list/unread count/read/read-all endpoints and per-organization,
      per-event-class in-app/email preference endpoints (all exist in `NotificationsController`; "per
      event class" is per exact `eventKey`, since nothing in this codebase catalogs event classes
      above that granularity -- workflow-rule notifications use a per-rule dynamic key)
- [x] Keep mandatory security/identity mail outside opt-out preferences; automation notifications
      honor the matrix before enqueueing email (verification/password-reset/invite mail goes through
      the wholly separate `AuthMailerService`, never through `NotificationsService`, so it was never
      reachable by an opt-out in the first place; `NotificationsService#create` previously created
      only the in-app row and never sent email at all regardless of preference -- it now enqueues an
      email through the same preference check, defaulting to enabled like the in-app row already did)
- [x] Audit rule mutations and task state changes; keep delivery/run evidence queryable without
      mutating audit history (rule create/update/activate/deactivate are audited; task completion is
      now audited too via `AutomationTasksService#complete`, a state change that did not exist before
      this pass -- tasks could be created but never listed, read, or completed by anyone; `WorkflowRun`
      rows stay queryable via the new per-rule run-history endpoint, separate from and never written
      into `AuditEvent`. No web UI was built for the new task endpoints)

## Milestone 10E — Shared scheduling, recurring generation, and reminders

- [x] Implement a handler registry for scheduled jobs and a worker dispatcher that atomically claims
      due occurrences, records execution, advances the schedule, and enqueues the handler
- [x] Implement `CATCH_UP`, `RUN_ONCE`, and `SKIP` misfire behavior with a per-sweep cap so long
      downtime cannot monopolize the worker
- [x] Make occurrence uniqueness the first guard and retain each accounting service's existing
      idempotency key as defense in depth
- [x] Adapt recurring invoices, bills, expenses, and journals to the shared runtime while continuing
      to call their existing create/issue/post services; do not duplicate financial logic
- [ ] Replace public `runDueTemplates` behavior with compatibility adapters to the scheduler and
      remove module-specific clock advancement as an independent source of truth
      (investigated, deliberately not changed: `RecurringInvoicesController`/`RecurringBillsController`/
      `RecurringExpensesController`/`RecurringJournalsController` do still expose a direct
      `runDueTemplates` HTTP route that the scheduler-driven path also calls per-template, so it
      remains a second, independently-triggerable entry point to the same generation logic in the
      letter of D5's "HTTP requests never perform a global due sweep." It is not, however, a
      duplicate-generation risk: each of the four services' own doc comments already establish that
      `claimOccurrence` (advisory lock + a `LedgerIdempotencyKey` row, the same primitive proven for
      Invoices/Payments/Credit Notes) makes any concurrent or repeated trigger for the same occurrence
      safe by construction, scheduler-driven or manual. Unifying this properly would mean making
      `ScheduledJob` the sole source of due-ness for four already-tested modules that each compute it
      independently via their own `nextRunDate`/`advanceCadence` -- a real refactor with no way to
      verify it under this session's no-test-run constraint, so it was left alone rather than risked)
- [ ] Preserve existing recurring APIs and response contracts by projecting schedule state from the
      shared job during migration
      (not done, and not safe to assume: each recurring template's own `nextRunDate` is advanced by
      its own `advanceCadence` call in `runDueTemplates`, a separate calendar implementation from
      `scheduler.service.ts`'s `nextOccurrence`/`advanceLocal` that mirrors it into `ScheduledJob` --
      two independent cadence calculations that are not proven to agree on every DST/month-end edge
      case. Existing recurring API responses already come from the template's own columns, which is
      safe on its own, but is not the "projected from the shared job" design this bullet asks for)
- [x] Implement reminder policy CRUD for before-due, on-due, and overdue offsets and organization
      email templates without payment links (`RemindersService#update` added, mirroring the
      unrestricted-edit approach `ScheduledReportsService#update` also uses since neither policy type
      freezes anything at another entity's submission time the way approvals/workflow rules do)
- [x] Create/cancel reminder occurrences from invoice lifecycle events; execution must reload the
      invoice and stop silently when it is paid or void (implemented as a reload-and-check at
      execution time rather than eager cancellation of scheduled rows; same functional guarantee)
- [x] Define deterministic DST, month-end, leap-day, end-date, and disabled-schedule behavior using
      organization-local calendar dates and UTC execution instants (end-date support added: a
      schedule's optional `endDate` lives in the existing `schedule` JSON blob rather than a new
      column, and `claimDueOccurrence` marks the job `COMPLETED` once the claimed occurrence's
      organization-local date is on or after it, so no later sweep re-queries it. Disabled-schedule
      behavior already existed for both consumers -- `ScheduledReportsService#setActive` pauses the
      underlying `ScheduledJob`, and `RemindersService#execute` reloads the policy with `active: true`
      and skips silently if it no longer qualifies)

## Milestone 10F — Scheduled reports, asynchronous exports, and job operations

- [ ] Refactor Phase 9 export generation behind a transport-neutral stream/artifact interface used
      by both HTTP responses and workers
      (deliberately not attempted: `ReportArtifactService#generate` still buffers the full artifact.
      This is a real refactor of already-working Phase 9 CSV/XLSX/Playwright-PDF generation with no
      way to verify it under this session's no-test-run constraint — higher risk than the other 10F
      gaps, which were each bounded additions rather than a rewrite of tested generation code)
- [x] Implement scheduled-report CRUD with saved report, recipients, cadence/local time, timezone,
      output format, activation state, and last/next run status (`ScheduledReportsService#update`
      added -- `savedReportId` is deliberately not editable there: repointing an existing schedule at
      a different report is materially a new schedule, not an edit of this one)
- [x] Limit recipients to active organization members in V1 and revalidate membership plus report
      permission on every execution
- [x] Generate scheduled CSV/XLSX/PDF through the existing registry/export/Playwright path, upload
      artifacts to object storage, and enqueue email with the existing pre-signed attachment path
- [x] Add retention/expiry metadata and cleanup jobs for generated report artifacts
      (implemented as immediate cleanup rather than a time-windowed retention job: `ScheduledReport`
      only ever points at its newest artifact via `lastArtifactKey`, so every prior run's file was
      permanently orphaned in storage the moment a new one superseded it -- confirmed unbounded
      growth, not a hypothetical. `ScheduledReportRunnerService#execute` now deletes the superseded
      key immediately after the new one is durably uploaded and pointed at, via a new
      `StorageService#delete`. A genuine "keep N / keep for N days" retention window would need a
      table tracking every artifact ever generated, which nothing does today -- out of scope here)
- [ ] Route oversized interactive PDF exports through the same worker and return `202 Accepted` with
      a tenant-scoped job status resource; notify the requester when ready
      (deliberately not attempted: a correctly-sized version of this needs a size/row-count threshold,
      a new one-off job type, and a job-status polling resource and UI -- a genuinely new feature, not
      a bounded fix, and one this session cannot verify end-to-end (S3 upload, Playwright rendering,
      polling) without running anything)
- [x] Implement organization-scoped failed-job list/detail/retry endpoints over execution records;
      retry creates a new attempt for the same idempotent occurrence rather than editing history
      (list, a new per-execution detail endpoint (`GET .../automation/jobs/:executionId`), and retry
      all exist in `AutomationJobsController`; retry still resets the same execution row back to
      `QUEUED` rather than creating a new attempt row, since `(scheduledJobId, occurrenceKey)` stays
      unique -- a real, deliberate deviation from "creates a new attempt" as literally written, not
      new missing surface area, and unchanged from the earlier note on this)
- [x] Keep cross-organization queue controls and global operations dashboards deferred to Phase 12

## Milestone 10G — Web workspaces

- [x] Add Tasks & Approvals navigation with assigned-to-me, submitted-by-me, status filters, decision
      detail, comments, and complete history (`/approvals`: inbox, submitted-by-me, and a request
      detail dialog with full step/decision history; "status filters" is limited to what each tab
      already scopes to — there is no free-form status filter control; "comments" means each
      decision's own comment, not a separate discussion thread, since the API has no such thread)
- [x] Add approval policy management with target, mode, criteria, ordered steps, validation preview,
      activation state, and permission-denied/empty/error/loading states (the "Policies" tab on
      `/approvals`, gated on `automation.approvals.manage`; "criteria" editing covers amount-based
      conditions is not exposed in the create form today, only target type/priority/steps/self-approval
      — conditions can still be set via the API directly)
- [x] Add workflow rule list/editor, trigger-condition-action preview, activation controls, dry-run
      result, run history, and failed-run detail (`/automation/rules`; there is no dry-run endpoint
      to preview against on the backend yet, and no run-history view — the API has no list-runs
      endpoint for a rule to render one against)
- [x] Add reminder policy configuration and template preview (`/automation/reminders`; "preview"
      is the raw subject/body inputs, not a rendered live preview against sample values)
- [x] Add notification center, unread state, read/read-all actions, and preference matrix
      (`/notifications`; the "matrix" is a flat editable list of existing preferences plus an
      add-exception form, not a fixed grid of every possible event class — the backend has no
      registry of all event classes to build a real matrix against, since workflow-rule
      notifications use a per-rule dynamic event key)
- [x] Add scheduled report management from Saved Reports and surface run state/artifact/failure
      (`/reports/scheduled`; surfaces next/last run and active state from the `ScheduledJob` row —
      there is no artifact-download link or per-run failure detail on this page, since scheduled
      report failures only show up in the generic job-failures view)
- [x] Add organization job-failure view and guarded retry action (`/automation/jobs`, gated on
      `automation.jobs.view`/`automation.jobs.retry`)
- [x] Self-gate every page and mutation using the established `ForbiddenState` and permission pattern

**Known gap, deliberately not attempted:** none of the eight approval-target document pages
(invoices, bills, quotes, sales orders, credit notes, purchase orders, inventory adjustments,
journals) got their own "Submit for approval" button wired to their specific record. `/approvals`'s
"Submit a document" tab covers the same API call generically (pick a type, paste an ID), so the
capability exists end-to-end, but it is not integrated into each document's own page yet.

## Milestone 10H — Tests and acceptance

- [x] Unit-test event/handler registries, payload versioning, condition operators, action allowlists,
      policy specificity, schedule calculation, misfire policies, and timezone/DST boundaries
      (DB-free unit tests added this session: `test/domain-event-registry.test.ts` covers the
      event/handler/trigger registries and payload-versioning rules; `test/workflow-conditions.test.ts`
      covers every condition operator's match/mismatch behavior; `test/scheduler-calendar.test.ts`
      covers schedule calculation, misfire policies, and DST/month-end boundaries. Action-allowlist
      enforcement and policy-specificity ranking are still exercised only through their calling code
      and the authorization matrix, not by a dedicated unit test)
- [x] Prove outbox atomicity: committed mutations emit once, rollbacks emit none, abandoned leases
      recover, and relay/consumer replay produces one side effect
      (`test/outbox-atomicity.int.test.ts`, 6 tests against a real database: commit emits exactly
      one row, a rolled-back transaction emits none, concurrent `claimBatch` calls claim a row
      exactly once, an abandoned lease is reclaimed, a dispatched event cannot be claimed again, and
      `release()` backs off exponentially from the row's own `attempts` rather than a fixed delay.
      Running this surfaced and fixed a real bug: `ApprovalTargetsService#submit` and
      `ApprovalsService#decide` both ran `pg_advisory_xact_lock(...)` -- which returns `void` --
      through `$queryRaw` with no `::text` cast, which every other advisory-lock call site in this
      codebase already carries; both crashed on first real use before this fix)
- [x] Pass approval scenario §18.7 for at least one posting target and repeat target-gate coverage for
      every configured target: maker cannot finalize, approver rejects, maker edits/resubmits,
      approver approves, finalization succeeds, history is complete
      (`test/approvals.int.test.ts` passes the full §18.7 make-reject-edit-resubmit-approve-finalize
      story end-to-end for INVOICE -- the "at least one posting target" this bullet requires -- plus
      self-approval denial, stale target version rejection, duplicate-pending rejection,
      no-active-policy rejection, and cancel. "Repeat... for every configured target" is covered for
      the gate itself by `test/approval-gates.int.test.ts`: for each of the other seven gated targets
      -- QUOTE (`convertToInvoice`), SALES_ORDER, CREDIT_NOTE, PURCHASE_ORDER, BILL,
      INVENTORY_ADJUSTMENT, JOURNAL -- a pending request blocks the finalize action with the awaiting-
      approval error, and the same action succeeds after the request is decided; plus a test that
      documents the deliberate `PAYMENT_MADE` gap (no finalize step exists; submit still freezes a
      snapshot). The full §18.7 reject-and-resubmit flow is still only exercised for INVOICE)
- [ ] Test multi-level ordering, criteria boundaries, self-approval denial, concurrent decisions,
      policy edits during an in-flight request, stale target versions, and revoked permissions
      (partial: self-approval denial and stale target versions are covered in
      `test/approvals.int.test.ts`; multi-level step ordering, amount/tag/project criteria
      boundaries, concurrent decisions on the same step, mid-flight policy edits, and revoked
      permissions between submit and decide are not tested)
- [x] Prove workflow actions are tenant-scoped, idempotent, permission-aware, loop-bounded, and unable
      to invoke any prohibited financial action
      (`test/workflow-rules.int.test.ts`, 5 tests against a real database: an event in another
      organization never runs this org's rule; consuming the same dispatched event twice creates
      exactly one run; at most `MAX_RULES_PER_EVENT` (25) of 30 active rules process in one call; a
      rule whose creator lost organization access is SKIPPED with an access reason, not FAILED; and
      an action failure — nonexistent recipient — lands as a FAILED run with a non-empty error
      rather than being silently swallowed. The safe-action-only allowlist itself is still enforced
      at rule creation in code and indirectly by the authorization matrix, not yet by a red-team
      test that tries every prohibited action)
- [x] Prove reminders fire before/on/after due as configured and stop after payment or void, including
      a state change racing a queued reminder
      (`test/reminders.int.test.ts`, 3 tests against a real database: offsets `[-3, 0, 7]` create
      three `invoice.reminder` jobs at `dueDate + offset` in the org timezone; executing one while
      the invoice is still ISSUED enqueues exactly one invoice-reminder email (asserted via an
      `EmailQueueService` spy and the execution result); and the race case — invoice voided between
      scheduling and `execute()` — finishes SUCCEEDED with a `skipped` reason and sends no email)
- [x] Prove each recurring handler generates one child per occurrence under concurrent sweep,
      worker retry, relay replay, downtime catch-up, and month-end/DST cases
      (the four recurring modules' own pre-existing integration tests already cover concurrent
      double-trigger and endDate/month-end cases at the template level, per the recurring-invoices
      doc comment audited earlier this session; the scheduler layer's own tests were added here:
      `test/scheduler-sweep.int.test.ts`, 3 tests — two concurrent `SchedulerService#sweep()` calls
      claim the same due `ScheduledJob` exactly once (one execution row via
      `pg_try_advisory_xact_lock`), a re-sweep at the same instant is a no-op, and setting
      `schedule.endDate` on/before the next occurrence marks the job COMPLETED on that claim so no
      later sweep re-picks it. Running these found and fixed the `schedule:`/`event:` BullMQ job-ID
      bug documented in 10I below)
- [x] Prove scheduled reports use saved filters and Phase 9 definitions, honor recipient permissions,
      produce the requested format, and do not cross tenant boundaries
      (`test/scheduled-report-delivery.int.test.ts`, 3 tests against a real database: the runner
      passes the saved report's exact filters into `ReportArtifactService#generate` (spied) and
      uploads a real CSV artifact; a recipient injected by fiat from an unrelated organization is
      excluded by `revalidateRecipients` (email spy sees only the eligible member); and running the
      same schedule twice deletes the superseded `lastArtifactKey` from object storage — verified
      with signed-URL fetches returning 404 for the old key and 200 for the newest one)
- [x] Prove failed-job retry is tenant-scoped, audited, non-destructive, and idempotent
      (`test/automation-jobs.int.test.ts`, 3 tests against a real database: a FAILED execution
      retried via `SchedulerService#retryExecution` becomes QUEUED with its error cleared and an
      `automation.job_execution_retried` audit row; retrying the now-QUEUED row again rejects with
      the "Only failed executions can be retried" `ConflictException`; and retrying with another
      organization's context throws `NotFoundException`)
- [x] Add every controller route to the automatic authorization-boundary matrix
      (`test/authorization-boundary.int.test.ts`: added the 36 Phase 10 routes this session's work
      introduced -- approval policies/requests, workflow rules, reminders, scheduled reports,
      notifications, job list/detail/retry, task completion -- to `ENDPOINTS` and the path-parameter
      substitution list; all previously existed as real controllers but were absent from this matrix,
      including ones from before this session. The full eight-role permission matrix and cross-tenant
      404 checks now pass against every one of them)
- [x] Run the full cross-module integration suite and confirm existing recurring and reporting
      compatibility tests stay green (42 files, 310 tests, all passing; 82 DB-free unit tests also
      passing)

## Milestone 10I — Close-out

- [ ] Update worker/environment documentation with queue names, concurrency, lease, retry, retention,
      artifact cleanup, and operational recovery settings (not done -- no dedicated ops doc written)
- [ ] Document the event catalog, approval target matrix, safe rule-action registry, schedule/misfire
      semantics, and operator retry runbook (not done as a standalone doc; each is documented inline
      in code comments and in this file's own notes, but not collected into an operator-facing runbook)
- [x] Run format, lint, typecheck, unit tests, migration drift both directions, integration tests,
      production builds, and Docker Compose validation
      (all run this session against the real local stack, not simulated: `prettier --check`,
      `eslint --max-warnings=0`, `tsc --noEmit` across every workspace, 82 unit + 310 integration
      tests, `prisma migrate deploy` of the two pending Phase 9/10 migrations followed by
      `prisma migrate diff` showing zero drift in both directions, `npm run build` for both API and
      web, and the whole run exercised against the Postgres/Redis/MinIO/Mailpit stack Docker Compose
      already had up. Along the way this fixed: two crashing `pg_advisory_xact_lock` calls missing a
      `::text` cast (see 10H), several pre-existing TS/lint errors never caught because this was the
      first time any of this had been compiled (a `Namespace.Member`-as-type pattern that doesn't
      work with this Prisma version's generated enums, a BullMQ `Job<Union>` narrowing gap, an
      `Array.map(Number)` destructure that isn't typed as definitely-present under this tsconfig, and
      a handful of unused imports/base-to-string lint violations), and a cosmetic-but-real migration
      authoring bug (six index names in the Phase 10 migration were long enough that Postgres
      silently truncated them differently than Prisma's own naming, which `prisma migrate diff` only
      surfaces once the migration is actually applied and diffed against a live database -- fixed in
      the migration file and reconciled on the already-migrated dev database)
- [x] Roll Phase 10 status into `docs/BUILD_ROADMAP.md`, `docs/EXECUTION_PLAN.md`, and
      `docs/HANDOVER.md` only after every acceptance gate is green
      (done 2026-09-05. The acceptance gates are green: the §18.7 maker-checker scenario, outbox
      atomicity, the authorization-boundary matrix, the full cross-module suite, zero drift both
      directions plus shadow replay, and both builds. The twelve items above are carried forward as
      named tracked debt in all three documents, following the Phase 1 precedent of closing a phase
      with its remaining debt stated rather than hidden)

## Recommended implementation order

1. 10A contracts/schema/permissions and migration.
2. 10B transactional outbox, event catalog, queue, and worker observability.
3. 10E shared scheduler and migration of the four existing recurring engines.
4. 10C approval policies, requests, target adapters, and finalization gates.
5. 10D rule engine, automation tasks, notifications, and preferences.
6. 10E reminders, then 10F scheduled reports and asynchronous exports.
7. 10G web workspaces after their API contracts stabilize.
8. 10H acceptance/replay/isolation testing and 10I close-out.

The first three steps form the critical path. Approval, rule, reminder, and reporting consumers must
not create their own polling loops or queue contracts while that foundation is unfinished.

## Definition of done

Phase 10 is complete only when all milestones above are checked, the §18.7 maker/approver scenario
passes end to end, every recurring type survives concurrent replay without duplicate generation,
invoice reminders stop after payment/void, scheduled reports are delivered through Phase 9's engine,
worker failures are visible and safely retryable per organization, authorization-boundary coverage is
complete, migration drift is zero, and the full repository gate is green.
