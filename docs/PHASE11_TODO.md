# RetailBooks Phase 11 Portals and Collaboration implementation plan

Durable progress record for Phase 11. `docs/BUILD_ROADMAP.md` remains the scope authority.
This file records the code-first implementation order, locked security decisions, and the later
verification gate.

**Status:** implementation complete; verification **partial**. Phase 11 is **not closed.** Every
box below is ticked only where this file's evidence ledger names a captured result. The remaining
gates — full-suite integration rerun, lint, production builds, E2E, visual review, design detector,
drift/replay — have **not** been run to completion since the final round of fixes, and are listed
as open at the bottom.

## Locked decisions

- Portal users reuse the verified RetailBooks `User` and session infrastructure, but access books
  only through a separate revocable `PortalUser` grant; they are never implicit organization members.
- A customer can have multiple portal users. Invitations are bound to the invited email and can be
  accepted only by that verified user.
- Portal users can update display name, customer email, phone, and default billing/shipping addresses.
  A customer-email change never changes the user's sign-in email.
- Customer-visible comments and attachments are explicit for internal users and mandatory for portal
  authors. Internal content never appears in a portal response.
- Customer documents are visible by lifecycle, never while draft. A sales order records its first
  confirmation so it remains visible as history after fulfilment or cancellation.
- Collaboration covers all current transaction-detail surfaces through one target registry.
- A listing is not an authorization to fetch bytes: attachment download URLs are issued only by a
  dedicated, re-authorized endpoint. The Bills/Expenses adapters follow the same rule.

## Milestone 11A - Contracts schema permissions and migration

- [x] Add `PortalUser`, `PortalInvitation`, append-only `Comment`, and append-only `Activity` models.
- [x] Extend `Attachment` with collaboration target, visibility, and portal-author data.
- [x] Add sales-order customer-visibility lifecycle data and tenant-prefixed indexes.
- [x] Add contracts for portal access/invitations/documents/profile and collaboration resources.
- [x] Add collaboration permission keys, role defaults, and `OrganizationSummary.roleKey`.
- [x] Write the Phase 11 migration, including safe historical activity/attachment backfill.
- [x] Grant the collaboration defaults to the remaining system roles, with a backfill migration
      (`20260908160000_grant_collaboration_role_defaults`) for organizations seeded earlier.

## Milestone 11B - Portal identity access and invitations

- [x] Implement portal invitation issue, preview, resend, revoke, acceptance, and grant revocation.
- [x] Add `PortalAccessGuard`/`PortalContext` with uniform non-disclosure failures.
- [x] Add customer-detail portal-user management APIs and rate limits.

## Milestone 11C - Customer portal documents and profile

- [x] Add customer-scoped portal document, statement, quote-decision, and profile APIs.
- [x] Add explicit customer-safe projections and lifecycle filtering.
- [x] Extend PDF rendering for sales orders and payment receipts; retain immutable snapshot behavior.
- [x] Make portal quote acceptance/decline atomic and attributable.
- [x] Add a portal profile read endpoint and a CSV statement export rendered from the same
      projection the on-screen statement uses.

## Milestone 11D - Accountant collaboration

- [x] Preserve Accountant as a normal membership and expose role context in organization summaries.
- [x] Improve multi-client organization switching without privilege or stale-route leakage.

## Milestone 11E - Comments and attachments

- [x] Add collaboration target registry and generic internal APIs.
- [x] Retain bill/expense attachment routes as compatibility adapters, including the re-authorized
      download endpoint the Phase 11 listing change made necessary.
- [x] Enforce customer visibility, parent permissions, upload validation, short-lived download links, and audit evidence.

## Milestone 11F - Unified activity timeline

- [x] Project supported audit events into activity in the originating transaction.
- [x] Add target-level comment, attachment, portal, and lifecycle activity.
- [x] Backfill recognized historic activity and add stable cursor pagination.

## Milestone 11G - Web surfaces

- [x] Add the separate `/portal` shell, invitation flow, account switcher, overview, document
      download, statement detail and export, quote-decision confirmation, and full profile and
      address editing surfaces.
- [x] Add reusable internal Comments, Files, and Activity panels to transaction detail surfaces
      (all twelve current detail routes, not Bills alone).
- [x] Implement accessible loading, empty, error, revoked, success, responsive, and keyboard states
      in the portal and the collaboration panel. **Written, not yet browser-verified** — see the
      open gates below.

## Milestone 11H - Tests and acceptance

- [x] Add portal invitation, isolation, lifecycle, concurrency, collaboration-visibility,
      file-validation, activity, and accountant-switching coverage
      (`apps/api/test/portals.int.test.ts`, `apps/api/test/collaboration.int.test.ts`).
- [x] Add the portal authorization-boundary matrix, and extend the internal matrix to the Phase 11
      organization-scoped routes.
- [ ] Critical portal E2E/accessibility coverage — **written** (`apps/web/e2e/phase11-portal.spec.ts`)
      but **never executed**; no browser has run it.

## Milestone 11I - Verification and close-out

- [x] Apply the migration locally and replay it from scratch in the dedicated E2E database.
- [ ] Run format, lint, typecheck, unit/integration/E2E tests, API/web production builds, and design
      detector. **Partial — see the ledger below.**
- [ ] Visually review desktop and mobile portal states.
- [ ] Roll verified status into roadmap, execution plan, and handover.

## Defects found and fixed during this pass

Each was found by a test written in this pass, and each was a live failure, not a hypothetical.

1. **The demo seed asserted a hard-coded 13 system-account keys** while the catalog holds 15
   (`customer_credit`/`vendor_credit` arrived with credit notes). Every `e2e:prepare` failed at the
   seed step, which is the actual cause of the "managed-server lifecycle failure with no browser
   test IDs" recorded earlier. The assertion now derives from `SYSTEM_ACCOUNT_KEYS.length`.
2. **`PortalsService.invite` wrote a `notifiedAt` column that does not exist on
   `PortalInvitation`.** Portal invitations failed at runtime for every caller. The write was
   invisible to the compiler because the transaction client was cast to `any`.
3. **`requireInternalTarget` selected `contactId` on every target model.** Bills, expenses,
   journals, transfers, adjustments, projects and the rest have no such column, so the collaboration
   panel returned 500 on all of them. Only `id` is selected now; customer eligibility is the
   registry's flag, not a column.
4. **The activity cursor DTO capped `cursor` at 100 characters**, but an issued cursor is roughly 116. The second page of any timeline was unreachable. The cap is now 512.
5. **A profile save that changed only addresses returned 404**, because existence was inferred from
   an empty `updateMany` count. Existence is now established by a scoped read.
6. **The audit-to-activity projection issued a second write per audit event inside every posting
   transaction**, which pushed long postings (a multi-line inventory adjustment) past Prisma's
   interactive-transaction deadline — `inventory.int.test.ts` failed with "Transaction not found".
   The projection is now nested in the audit insert: one round trip, one shared `occurredAt`.
7. **PURCHASES, INVENTORY_MANAGER, PROJECT_MANAGER and VIEWER held no collaboration permissions**,
   so the panel was inert on exactly the documents those roles own. Defaults added, with a backfill
   migration for existing organizations.
8. **The Phase 11 organization-scoped routes were absent from the authorization-boundary matrix**,
   and the collaboration write routes enforced their permissions in the service rather than on the
   route, so the matrix could not see them. Both are now declared on the route.
9. **Phase 11 removed `downloadUrl` from attachment listings without giving the Bills and Expenses
   adapters a download endpoint.** Their list route and both web surfaces were broken. A
   re-authorized download endpoint was added and the UI now requests the link on click.
10. **A sales order re-confirmed after cancellation rewrote `portalVisibleAt`**, moving the document
    in the customer's history. Only the first confirmation stamps it now.
11. **`/portal/login` redirected to `/` on success**, dropping a customer with no membership into
    internal onboarding. `AuthForm` now takes a destination.

## Evidence ledger — 2026-09-08

**Captured as passing:**

- Prisma client generation, after the Phase 11 schema and role-default changes.
- API TypeScript check (`tsc --noEmit`) — passing as of the final code change.
- Web TypeScript check — passing as of the final code change.
- `prettier --check .` across the repository — passing.
- `apps/api/test/portals.int.test.ts` — **29 of 29 tests passing**.
- `apps/api/test/collaboration.int.test.ts` — **21 of 21 tests passing**.
- `apps/api/test/authorization-boundary.int.test.ts` — **6 of 6 tests passing**, including the
  matrix-synchronization check against every registered organization-scoped route.
- Local Prisma migration deploy of `20260908160000_grant_collaboration_role_defaults`.
- Whole integration suite at the mid-session checkpoint: **382 of 385 passing, 3 failing.** All
  three failures are defects 1, 3 and 6 above; all three have since been fixed, but the suite has
  **not been rerun to completion afterwards**, so this line is a checkpoint, not a green gate.

**Not run, or run without a captured final result — every one of these is open:**

- Full integration suite rerun after the final fixes. Until it is captured, the whole-suite result
  stands at the 382/385 checkpoint above.
- `npm run lint`. It was failing with roughly 75 `no-unsafe-*` errors concentrated in
  `portals.service.ts`, caused by removing the `prisma as any` escape hatches. Those types were then
  written, but the lint run that would prove it was never captured.
- API production build and web production build.
- Playwright: `apps/web/e2e/phase11-portal.spec.ts` has never executed. The webServer timeouts were
  raised from 120s/180s to 900s (a cold prepare, Nest build, demo seed and Next production build do
  not fit in two minutes), and the seed defect that blocked the gate is fixed, but no browser run
  has been performed.
- Visual review, screenshot baselines for the portal, keyboard and responsive verification in a real
  browser. The keyboard and responsive assertions exist in the spec; none has run.
- Frontend design detector.
- Forward/reverse migration drift and replay verification including the new backfill migration.

## What a reviewer should do first

1. `npm run lint` — the most likely place to still be red, and the cheapest to check.
2. `npm --workspace @retailbooks/api run test:integration` — one clean full-suite capture.
3. `npm --workspace @retailbooks/web run test:e2e` — the first browser run of the portal.

Nothing in this file should be promoted to "verified" without the corresponding captured output.
