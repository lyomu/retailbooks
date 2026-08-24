# ADR 0009: Phase 1 product surfaces

- Status: Accepted
- Date: 2026-08-17

## Context

Milestone 1I's checklist ("implement organization/fiscal-period/numbering/localization/tax settings,"
"implement team/roles/invitations/sessions/audit-log surfaces," "add route-level loading/error/
forbidden/not-found states") reads as a full inventory of Phase 1 web surfaces, but by the time this
milestone started most of it was already built: chart of accounts, journals, trial balance,
account-ledger inquiry (1G), tax codes (1H), and team/roles/invitations/sessions (1D/1E/1C) all had
working UI. Auditing the actual route table and nav array found six real gaps: organization-profile
settings, fiscal-period settings, numbering settings, an audit log (which did not exist at all,
frontend or backend), a dashboard that was 100% hardcoded placeholder data, and the complete absence
of Next.js route-level `loading.tsx`/`error.tsx`/`not-found.tsx` files anywhere in the app.

## Decision

- **Audit log is the only new backend surface.** `SecurityEvent` rows have been written by every
  mutating service since 1C (28 distinct `eventKey` values by this milestone) but nothing ever read
  them back. A new `AuditLogService`/`AuditLogController` pair (inside `apps/api/src/organizations/`,
  registered in the existing `OrganizationsModule` alongside `TaxController`/`LedgerController`, not a
  new module) exposes `GET /organizations/:id/audit-log`, gated by a new `audit.view` permission key.
- **`audit.view` defaults to OWNER/ADMIN/ACCOUNTANT, not STAFF.** Unlike the current-state views STAFF
  already holds (chart of accounts, journals), a cross-module history feed surfaces every member
  removal, role change, and tax-code edit — materially more sensitive. It is not `protected`, so an
  organization can widen it via `roles.manage` if it chooses; this is a default posture, not a rule.
- **Audit-log pagination uses a keyset cursor** over `(occurredAt, id)`, base64-encoded, rather than
  offset/skip. This is the API's first real pagination pattern — every other list endpoint is either a
  fully unbounded `findMany` or a flat `take: 100` — chosen because `security_events` is append-only
  and unbounded by construction (every mutation everywhere writes a row), and the existing
  `[organizationId, occurredAt]` index supports keyset paging in O(limit) regardless of scroll depth,
  unlike `skip`, which degrades linearly. `apps/api/src/organizations/audit-log-cursor.ts` isolates the
  pure encode/decode logic from the Prisma-touching service, following the same separation
  `tax-rate-resolution.ts` established in 1H.
- **Numbering settings call the dedicated `numbering.manage` endpoint**, not `PATCH /organizations/:id`
  with `section: 'NUMBERING'`. The dedicated endpoint keeps the live `DocumentNumberSequence` scope row
  in sync; the organization-update path is a legacy route reachable from onboarding that only touches
  the preference row and would silently desynchronize the active sequence if used post-onboarding.
- **Organization-profile settings submits one `PATCH /organizations/:id` per section** (`PROFILE`,
  `JURISDICTION`, `ACCOUNTING`, `TAX`), matching how that endpoint has been section-scoped since 1D and
  how the onboarding wizard already calls it. Four independent forms, not one combined form.
- **Route placement follows the two conventions 1G/1H already established**: "Finance controls"
  sidebar items are top-level routes (`/periods`, `/numbering`, joining `/tax`); "Organization" sidebar
  items live under `/settings/*` (`/settings/organization`, `/settings/audit-log`, joining
  `/settings/team`, `/settings/security`).
- **UI pattern split by surface shape, not by novelty.** Organization-profile and numbering (small
  field counts, mostly forms) use the `.rb-security-*` settings-section pattern `team-management.tsx`
  established; fiscal periods (a grouped list with per-item state-transition actions) and the audit log
  (a long, filterable table) use the `.rb-ledger-*`/`DataTable` pattern `ledger-workbench.tsx`/
  `tax-workbench.tsx` established.
- **A new shared `ForbiddenState` component** (`packages/ui`, a sibling of `EmptyState`) is used only
  by the audit-log page — the first page whose minimum view permission (`audit.view`) isn't granted to
  every role by default. Every other settings page keeps its existing hide-the-control-not-the-page
  pattern unchanged, since their view permissions (`organization.view`, `periods.view`,
  `numbering.view`, `members.view`) remain universal across roles.
- **The dashboard composes from existing endpoints only** (accounts, journals, trial balance, fiscal
  periods, tax codes — client-side, in parallel, no new backend route). The four hardcoded currency
  stat cards (Cash balance, Month revenue, Month expenses, Net position) and the fake all-zero cashflow
  chart are removed rather than approximated: there is no "cash account" concept anywhere in the
  schema, and inventing one to compute a plausible-looking number would violate the dashboard's own
  `STORY:` comment ("the owner scans position first... without invented financial activity"). In their
  place: real active-account/posted-journal/draft-journal counts, a real trial-balance balanced/
  out-of-balance status with real totals, the currently open fiscal period (or "Not started"), and a
  posted-journal-volume-by-month chart bucketed client-side from the already-fetched journal list
  (itself capped at the existing `take: 100`, with a caption noting the cap when hit). The
  "control status" and "next actions" panels became dynamic, replacing static text that had drifted
  false (e.g. a permanently-`Pending` "Fiscal periods: Configuration arrives in Milestone 1F" line,
  still present despite 1F having shipped fiscal periods two milestones earlier).
- **Route-level Next.js special files are root-only**, not per-route-segment overrides. Every existing
  page already renders its own local `Skeleton`/`rb-auth-error` for its in-page client fetch (no
  Suspense boundaries or server-side data fetching exist to trigger a segment-level `loading.tsx`
  anyway); only the router-transition moment and unhandled render exceptions were genuinely uncovered.
  `not-found.tsx` and the fallback content in `error.tsx` stay standalone (no `AppShell`), since a 404
  can be hit by a signed-out visitor and `AppShell` itself depends on workspace data that could itself
  be the thing failing. `global-error.tsx` covers the one case `error.tsx` cannot (a throw in the root
  layout itself) and deliberately avoids `@retailbooks/ui` component imports, using raw markup against
  the same CSS classes, since it is the last-resort fallback if something in that import chain is
  implicated in the failure.

## Consequences

- The audit log's keyset-cursor pattern is the template any future paginated list endpoint in this API
  should follow, rather than the unbounded `findMany`/flat `take: 100` used everywhere else today.
- `metadata` on each audit event is rendered as raw key/value data in the web UI for now; per-event-type
  formatting (e.g., a friendly diff view for `organization.section_updated`) is a natural, low-risk
  follow-on once real usage shows which event types most need it.
- The dashboard's KPI set is deliberately non-financial (counts and status, not currency figures)
  until a real notion of account classification (cash, revenue, expense) exists in the schema — adding
  one is out of this milestone's scope and would need its own design decision, not a dashboard-driven
  shortcut.
- HTTP-level tenant/permission integration tests for the new audit-log endpoint, and browser/visual QA
  for every new settings/dashboard screen, remain deferred to the agreed verification pass, matching
  every prior milestone's precedent. No migration was needed — the audit log reads the existing
  `SecurityEvent` table without any schema change.
