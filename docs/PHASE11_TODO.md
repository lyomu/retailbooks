# RetailBooks Phase 11 Portals and Collaboration implementation plan

Durable progress record for Phase 11. `docs/BUILD_ROADMAP.md` remains the scope authority.
This file records the code-first implementation order, locked security decisions, and the later
verification gate.

**Status:** implementation and authorized verification in progress. The Phase 11 migration is
applied to the local development and E2E databases. The portal shell now includes scoped-account
document reload, PDF downloads, a statement balance, and customer contact editing. Remaining
test-coverage, full detail collaboration, E2E server startup, visual-review, and close-out items
stay unchecked until they have direct evidence.

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

## Milestone 11A - Contracts schema permissions and migration

- [x] Add `PortalUser`, `PortalInvitation`, append-only `Comment`, and append-only `Activity` models.
- [x] Extend `Attachment` with collaboration target, visibility, and portal-author data.
- [x] Add sales-order customer-visibility lifecycle data and tenant-prefixed indexes.
- [x] Add contracts for portal access/invitations/documents/profile and collaboration resources.
- [x] Add collaboration permission keys, role defaults, and `OrganizationSummary.roleKey`.
- [x] Write the Phase 11 migration, including safe historical activity/attachment backfill.

## Milestone 11B - Portal identity access and invitations

- [x] Implement portal invitation issue, preview, resend, revoke, acceptance, and grant revocation.
- [x] Add `PortalAccessGuard`/`PortalContext` with uniform non-disclosure failures.
- [x] Add customer-detail portal-user management APIs and rate limits.

## Milestone 11C - Customer portal documents and profile

- [x] Add customer-scoped portal document, statement, quote-decision, and profile APIs.
- [x] Add explicit customer-safe projections and lifecycle filtering.
- [x] Extend PDF rendering for sales orders and payment receipts; retain immutable snapshot behavior.
- [x] Make portal quote acceptance/decline atomic and attributable.

## Milestone 11D - Accountant collaboration

- [x] Preserve Accountant as a normal membership and expose role context in organization summaries.
- [x] Improve multi-client organization switching without privilege or stale-route leakage.

## Milestone 11E - Comments and attachments

- [x] Add collaboration target registry and generic internal APIs.
- [x] Retain bill/expense attachment routes as compatibility adapters.
- [x] Enforce customer visibility, parent permissions, upload validation, short-lived download links, and audit evidence.

## Milestone 11F - Unified activity timeline

- [x] Project supported audit events into activity in the originating transaction.
- [x] Add target-level comment, attachment, portal, and lifecycle activity.
- [x] Backfill recognized historic activity and add stable cursor pagination.

## Milestone 11G - Web surfaces

- [x] Add the separate `/portal` shell, invitation flow, account switcher, overview, document download, statement balance, and profile editing surfaces.
- [ ] Add reusable internal Comments, Files, and Activity panels to transaction detail surfaces.
- [ ] Implement accessible loading, empty, error, revoked, success, responsive, and keyboard states.

## Milestone 11H - Tests and acceptance (requires explicit approval)

- [ ] Add portal invitation, isolation, lifecycle, concurrency, collaboration-visibility, file-validation, activity, and accountant-switching coverage.
- [ ] Add portal authorization-boundary matrix and critical portal E2E/accessibility coverage.

## Milestone 11I - Verification and close-out (requires explicit approval)

- [x] Apply the migration locally and replay it from scratch in the dedicated E2E database.
- [ ] Run format, lint, typecheck, unit/integration/E2E tests, API/web production builds, and design detector.
- [ ] Visually review desktop and mobile portal states.
- [ ] Roll verified status into roadmap, execution plan, and handover.

## Verification notes — 2026-09-08

- Prisma client generation completed after the Phase 11 schema update.
- Local migration deployment succeeded; Prisma migration status reports 32 migrations and an
  up-to-date schema.
- E2E preparation replayed all 32 migrations, including
  `20260908120000_add_phase11_portals_collaboration`, into `retailbooks_e2e`.
- API and web TypeScript checks passed. Formatting check and lint passed.
- API unit tests passed: 17 files and 117 tests. Web unit tests passed: 1 file and 6 tests.
- API production build passed. The web production build compiled and passed its lint/type stage
  after removing an unused portal-icon import; the final static-page completion output was not
  captured as a completed gate, so the tracker remains conservative.
- Integration tests stalled during existing authorization-boundary harness startup. E2E preparation
  exposed and fixed an empty Redis `DEL` cleanup call; it then continued into API build/seed when
  the previous execution window ended. Full integration/E2E completion, visual review, design
  detector, forward/reverse drift proof, and Phase 11-specific acceptance coverage remain open.
- The later single-worker integration rerun completed without the earlier concurrent-truncate
  deadlocks, but its detached terminal summary was not retained; it must be rerun with captured
  output before being credited.
- Portal UI now reloads documents when the customer account changes, requests a scoped signed PDF
  download, exposes the derived statement balance, and saves customer-facing profile fields.
- Playwright's E2E artifact reports a managed-server lifecycle failure with no browser test IDs.
  The failing chain is E2E preparation/API build-seed/start plus web build-start; browser journeys
  and visual assertions have not yet run.
