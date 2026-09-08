# RetailBooks Phase 12 Platform Admin implementation plan

Durable progress record for Phase 12. `docs/BUILD_ROADMAP.md` remains the scope authority.

**Status:** implementation in progress, **code first with tests deliberately deferred** by explicit
direction (2026-09-08). Nothing in this file may be read as verified. The test debt this creates is
recorded as named unchecked items in Milestone 12J rather than left implicit — the execution plan's
risk register (R6) warns that "code first, tests later" produced Phase 5's debt, and this is an
informed exception to it, not an oversight.

## Locked decisions

- **The platform-admin boundary is database-backed, not environment-backed.** Phase 8 shipped
  `PlatformAdminGuard` reading a `PLATFORM_ADMIN_EMAILS` allowlist, and its own comment names Phase
  12 as the point at which that is replaced. A `PlatformAdmin` grant row now carries the boundary.
  The environment allowlist survives only as a **bootstrap** path: it can mint the first grant on a
  deployment that has none, and is ignored once any active grant exists. A deployment with neither
  has no platform administrators, rather than trusting every authenticated session.
- **Three platform roles, not one.** `SUPPORT` reads; `OPERATIONS` additionally acts on jobs,
  suspensions and support tooling; `SUPERADMIN` additionally manages plans, entitlements, feature
  flags, country packs, tax definitions, and other platform administrators. A single "superadmin"
  bit would force every support engineer to hold the ability to change global reference data.
- **No impersonation in V1.** The roadmap prefers read-only support access, and impersonation is the
  single most dangerous feature in this phase. Support tooling is read-only; the models carry no
  impersonation session. If it is ever added it needs its own decision, banner, reason, expiry and
  audit — not a quiet extension of this work.
- **Platform admin never reads tenant financial data.** The platform API exposes organizations,
  users, plans, flags, jobs, security events, and aggregate analytics. It exposes no invoice,
  journal, ledger, payment or statement row. Analytics are counts and dates, never amounts.
- **Platform actions are audited separately from tenant actions.** `PlatformAuditEvent` is its own
  append-only log. Writing cross-tenant administrative actions into a tenant's `AuditEvent` would
  either scope them to one organization (wrong — many are cross-tenant) or leave them unscoped in a
  table every tenant reads.
- **Suspension is reversible and non-destructive.** Suspending an organization or a user blocks
  access and nothing else: no data is deleted, detached, or rewritten. It records who, when, and
  why, and reactivation clears the block while leaving the record of it.
- **Entitlement resolution is most-specific-wins, and is a pure function of stored rules.**
  Organization override beats plan, beats country, beats global, beats the flag's own default. The
  resolver is deterministic and side-effect free so it can later be cached, or moved into a request
  context, without changing behaviour.
- **Billing is modelled but not integrated.** `Plan` and `OrganizationSubscription` carry price,
  currency, interval and trial fields so a future billing provider has somewhere to land. Nothing
  in Phase 12 charges anyone, and no provider identifiers are stored.

## Milestone 12A - Platform boundary, schema, contracts

- [ ] Add `PlatformAdmin`, `PlatformAuditEvent`, `Plan`, `PlanEntitlement`,
      `OrganizationSubscription`, `FeatureFlag`, and `FeatureFlagRule` models.
- [ ] Add organization suspension metadata (who, when, why) and the matching user fields.
- [ ] Write the Phase 12 migration, including a default plan and the bootstrap grant path.
- [ ] Replace the environment-only `PlatformAdminGuard` with the grant-backed boundary, keeping the
      allowlist as a bootstrap-only fallback.
- [ ] Add `PlatformContext`, the role hierarchy, and a `RequirePlatformRole` decorator.
- [ ] Add Phase 12 contracts to `@retailbooks/contracts`.

## Milestone 12B - Plans, entitlements, feature flags

- [ ] Plan and entitlement CRUD, with plan assignment to an organization.
- [ ] Feature-flag CRUD and targeting rules across global/country/plan/organization scope.
- [ ] A deterministic entitlement/flag resolver, and an evaluation-preview endpoint that explains
      which rule won.

## Milestone 12C - Organizations and users administration

- [ ] Organization search and filter by status, country, plan, owner, and created date, with usage
      counters that never expose financial values.
- [ ] Suspend and reactivate an organization, with a required reason and full platform audit.
- [ ] User search, detail with memberships and security metadata, and status administration.

## Milestone 12D - Reference data administration

- [ ] Bring country-pack administration under the platform console and the new role hierarchy.
- [ ] Tax-definition administration over the versioned tax packs.

## Milestone 12E - Operations

- [ ] Cross-tenant queue health, failed scheduled-job executions, and retry controls.
- [ ] Cross-tenant security-event feed with severity and actor filtering.

## Milestone 12F - Product analytics

- [ ] Activation, first-invoice, reconciliation-use, module-adoption and retention aggregates,
      computed without reading financial amounts.

## Milestone 12G - Platform console UI

- [ ] Separate `/platform` shell with its own auth boundary and navigation.
- [ ] Organizations, users, plans and entitlements, feature flags, country packs, tax definitions,
      jobs, security events, and analytics screens.

## Milestone 12J - Deferred test debt (owed, not written)

Every item here is work Phase 12 would normally carry inside its milestones. It is listed so the
debt is named rather than discovered later.

- [ ] Platform boundary matrix: every `platform/*` route refuses a non-admin, and refuses an admin
      whose role is below the route's requirement.
- [ ] Bootstrap-path test: the environment allowlist mints a first grant and is then ignored.
- [ ] "No casual access to tenant financial data": an assertion over the platform controllers that
      no response projects a monetary column.
- [ ] Suspend/reactivate leaves tenant data intact and blocks access while suspended.
- [ ] Feature-flag targeting resolves correctly across all four scopes, including ties and
      precedence.
- [ ] Entitlement limits resolve per organization, including unlimited and trial states.
- [ ] Platform audit is written for every mutating platform action, with the reason preserved.
- [ ] Analytics aggregates reconcile against directly counted fixtures.
- [ ] Platform console E2E: sign-in boundary, organization suspension journey, flag targeting.
