# ADR 0005: Authorization and permission overrides

- Status: Accepted
- Date: 2026-08-17

## Context

Milestone 1D shipped organizations, membership, and invitations with a coarse role check
(`@OrganizationRoles(OWNER, ADMIN)`) as a stand-in for real authorization. Milestone 1E needs owner,
admin, accountant, and staff permission baselines; organization-scoped adjustments to those
baselines; central enforcement reflected safely in the UI; a guarantee that an organization can
never lose its owner or have privileges escalated past what a role should hold; and audit coverage
for membership, invitation, and role changes.

The reference material in `starter/` describes a fully dynamic RBAC engine — arbitrary custom roles
backed by `roles`/`permissions`/`role_permissions` tables, where organizations create their own named
roles. That approach was evaluated and declined. Phase 1 has exactly four roles with concrete,
stable meaning throughout the identity and tenancy model already built; nothing in Phase 1 needs an
organization to invent a fifth. A lighter design — keep the roles fixed, let organizations adjust
which permissions each role holds — covers the accepted checklist without the schema and UI surface
a dynamic-role CRUD system would add for a capability nothing yet consumes.

## Decision

- **Fixed roles, sparse overrides.** `OrganizationRole` (OWNER/ADMIN/ACCOUNTANT/STAFF) stays a fixed
  enum. `organization_role_permissions` is a sparse table: a row exists only where an organization's
  grant for a (role, permission) pair differs from the default baseline. Absence of a row means "use
  the default."
- **Permission catalog scoped to what exists.** The eleven permission keys
  (`organization.{view,update,finalize}`, `members.{view,invite,update,remove}`,
  `invitations.{view,revoke}`, `roles.{view,manage}`) cover only endpoints that exist today. A future
  module adds its own keys additively when it ships rather than reserving them in advance. Like the
  jurisdiction catalog, this data lives in `apps/api/src/organizations/permission-catalog.ts` — pure,
  framework-free — and is served to the web only through an API response
  (`GET /organizations/:id/roles`), because the compiled API loads workspace packages as types only;
  `packages/contracts` gains just the response-shape zod schemas.
- **Protected keys are the entire escalation defence.** `organization.finalize` and `roles.manage`
  are marked `protected` and are never overridable — `effectivePermissions()` ignores any override
  row that targets them, and `PermissionsService.updateRolePermissions` rejects a change that
  attempts one. Since only OWNER can ever reach `PATCH .../roles/:role` (that route itself requires
  `roles.manage`, which no role but OWNER holds and no override can grant), a permission can never be
  used to grant the ability to grant permissions. This replaces the reference blueprint's runtime
  "creator cannot grant a permission they lack" check with something simpler: the grant path for
  protected keys does not exist at all.
- **OWNER is total and immutable.** `effectivePermissions('OWNER', ...)` returns every catalog key
  and ignores `overrides` entirely, even defensively against a stray override row that somehow names
  OWNER. A member whose current role is OWNER can never be the target of
  `PATCH/DELETE .../members/:memberId`, and a role change can never set role to OWNER — the only path
  to ownership is creating an organization. Together these guarantee an organization can never end up
  without an owner, without needing to count how many owners exist. **Ownership transfer is
  explicitly out of Phase 1 scope** — a future milestone that adds it will need to relax this
  specific invariant deliberately, not incidentally.
- **Central enforcement.** `OrganizationAccessService.requireMembership` resolves a
  `permissions: ReadonlySet<PermissionKey>` alongside `role` on every request; `OrganizationGuard`
  checks a single `@RequirePermission(key)` decorator against it. The 1D role-allowlist
  (`OrganizationRoles`/`ORGANIZATION_ROLES_KEY`/`MANAGERS`) is fully removed — no parallel
  authorization mechanism remains anywhere in `apps/api/src`.
- **Audit on mutation.** Member role/status changes, member removal, and role-permission override
  changes each write a `SecurityEvent` inside the same transaction as the mutation, carrying the old
  and new values, following the pattern already established for organization and invitation events
  in 1D.
- **UI reflects the same data.** `GET /organizations` and `POST /organizations/:id/activate` return
  the caller's effective `permissions` for each organization; the web gates controls with a
  `hasPermission()` helper reading that array rather than re-deriving the role matrix client-side.
  The team page gained a "Roles & permissions" tab showing the full matrix — read-only for anyone
  with `roles.view` (every role, by default), editable only for whoever holds `roles.manage`.

## Consequences

- Adding a new module's endpoints means adding catalog keys and covering them in
  `DEFAULT_ROLE_PERMISSIONS`, not touching the resolution or guard logic.
- `permission-resolution.ts` (matrix resolution, owner-protection predicates) is covered by DB-free
  unit tests in `apps/api/test/permission-resolution.test.ts`, which pass. HTTP-level and
  cross-tenant negative-authorization integration tests — actually calling the API as different
  roles across organizations and asserting 403/404 — remain deferred, matching the 1C/1D precedent of
  deferring anything that needs a live database or browser.
- No ownership-transfer feature exists yet. Anything that assumes an organization could ever have
  more than one OWNER, or that OWNER could move between members, is out of scope until a later
  milestone revisits this ADR.
- Migration `202608170002_roles_and_permissions` has been written but not executed against
  PostgreSQL, per the same deferral as the 1D migration.
