# ADR 0004: Organization tenancy and onboarding

- Status: Accepted
- Date: 2026-08-17

## Context

Phase 1 requires organizations that hold every business-owned record, memberships that decide who
may reach them, invitations that work for both existing and brand-new users, and a self-service
setup flow that leaves an organization ready to keep books. Cross-tenant access is a
release-blocking defect, so the boundary must be structural rather than a convention each handler
remembers to follow.

## Decision

### Tenancy boundary

- `organizations` is the tenant root. Every organization-owned table carries `organization_id`:
  `organization_preferences`, `organization_members`, `organization_invitations`, and the new
  nullable `organization_id` on `security_events`.
- An organization identifier supplied by a client — route parameter, `x-organization-id` header, or
  the `rb_org` cookie — is never trusted on its own. `OrganizationAccessService.requireMembership`
  is the single place an identifier becomes a usable context, and it resolves access from the
  authenticated user's `organization_members` row.
- `OrganizationGuard` runs after `SessionGuard`, performs that resolution, and attaches
  `request.organization`. Service methods then scope every query by the resolved identifier as
  defence in depth.
- A non-member and an unknown identifier receive the same `404 Organization not found.`, so
  organization identifiers cannot be probed for existence. Suspension is a distinct `403`, which is
  only reachable by an actual member.
- `@OrganizationRoles(...)` supplies a role baseline for management actions. It is deliberately
  minimal; Milestone 1E replaces it with the full permission model.

### Active organization

- The `rb_org` cookie is `HttpOnly`, `SameSite=Lax`, and holds only a hint about which organization
  the browser last used. Because membership is re-validated on every request, a tampered value
  widens nothing; the worst case is a `404`. Signing out clears it alongside the session cookie.
- `GET /organizations` returns the organizations resolved from the session together with the
  active identifier, so the switcher can never offer an organization the user cannot reach.

### Onboarding

- Creation and finalization are two ends of one draft. `POST /organizations` writes the
  organization, its `OWNER` membership, and its preference defaults in a single transaction, so no
  organization ever exists without an owner or without foundation defaults.
- Setup progresses through `onboarding_step`. A saved section advances the draft and never rewinds
  it, which lets a partly finished setup resume in the right place.
- `POST /organizations/:id/finalize` validates completeness, flips `DRAFT` to `ACTIVE`, records
  `onboarding_completed_at`, and refreshes the country-pack stamp inside one transaction. An
  organization is therefore never half-activated.
- Email verification is required to create an organization, to finalize it, and to accept an
  invitation.

### Invitations

- Invitations use their own table rather than `action_tokens`, which is user-scoped and cannot
  address a recipient who has no account yet.
- Tokens are random and opaque; only a SHA-256 hash is stored. Issuing a new invitation for the
  same address revokes the previous pending one.
- Tokens travel in the request body (`POST /invitations/preview`, `POST /invitations/accept`)
  rather than the URL, keeping them out of access logs, referrers, and browser history.
- Acceptance requires an authenticated session whose verified email matches the invitation, and the
  claim is a conditional update on `status = PENDING`, so a replayed token cannot mint a second
  membership.
- Invitations raised while an organization is still a draft are stored but not delivered.
  Finalization reissues a fresh token for each and sends it, so a queued invitation never carries a
  token that predates the organization going live.
- An invitation can never grant `OWNER`. Ownership comes only from creating an organization until
  transfer arrives with the role model.

### Jurisdiction defaults

- The country, currency, time zone, locale, chart-template, and business-type catalog lives in
  `apps/api/src/organizations/jurisdiction-catalog.ts` and is served to the web application through
  `GET /organizations/reference-data`. One source of truth validates writes and populates the
  wizard.
- It is not a shared workspace package because the compiled API loads workspace packages as types
  only; a value import would resolve to TypeScript source at runtime.
- Every value is a configurable software default that stays editable per organization. Kenya is the
  demonstration pack; the rest carry a generic pack. Nothing here is a claim of statutory
  certification.

## Consequences

- Adding an organization-owned table means adding `organization_id` and reaching it only through a
  resolved context. Reviews should treat a query without an organization filter as a defect.
- The role baseline in this milestone is coarse. Milestone 1E must replace `@OrganizationRoles`
  rather than accumulate more role literals in controllers.
- Country packs are currently a code-level catalog. Milestone 1F replaces the `country_pack_code`
  and `country_pack_version` fields with versioned pack definitions; the fields exist now so the
  data is already stamped.
- Tenant-isolation integration tests remain a release requirement and are not yet written.
