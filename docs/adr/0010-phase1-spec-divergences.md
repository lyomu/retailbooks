# ADR 0010: Deliberate Phase 1 specification divergences

- Status: Accepted
- Date: 2026-08-24

## Context

The authoritative Phase 1 implementation pack defines a target architecture and product shape, but
several details conflict with conventions that were already implemented and proven in RetailBooks.
Closing the foundation gaps without recording those choices would leave the repository appearing to
violate its own specification and would invite later teams to reintroduce retired models or parallel
routing and authorization mechanisms.

This ADR records the accepted divergences after the Phase 1 foundation build. It supersedes the role
and permission-model portions of ADR 0005 and the historical `STAFF` references in ADRs 0008 and 0009.
The older ADRs remain useful records of what existed when their milestones shipped.

## Decision

| Specification shape                                   | RetailBooks decision                                                                                                                                                                                                                                                           | Rationale                                                                                                                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Organization-scoped web routes under `/app/[org]/...` | Keep the established flat product routes, such as `/journals`, `/tax`, and `/settings/currencies`. Organization identity is resolved through the authenticated workspace context, while organization-owned API routes continue to carry and guard the organization identifier. | Avoids a second parallel route tree and keeps tenant authorization in `OrganizationGuard`, not in client-side URL structure.                                                  |
| Decimal monetary amounts                              | Store money as integer `BigInt` minor units and exchange values as decimal strings at input/output boundaries. Exchange rates are persisted as `Decimal(20,10)` snapshots, then converted through scaled `BigInt` arithmetic.                                                  | Preserves exact double-entry, tax, rounding, and FX invariants without binary floating point. Currency metadata supplies the minor-unit precision.                            |
| Eight separate onboarding pages                       | Keep one `/onboarding` product surface that submits the existing section-scoped organization mutations and advances the persisted onboarding state. Finalization remains one atomic service transaction.                                                                       | Retains resumability and server-side completeness checks without duplicating fields and navigation across eight routes.                                                       |
| A separate `tax_regimes` table                        | Use organization preferences, versioned country-pack reference data, `TaxCode`, and effective-dated `TaxRate` rows for Phase 1.                                                                                                                                                | Those records cover the implemented tax behavior. A regime entity should be introduced only when a later statutory workflow has distinct lifecycle or reporting requirements. |
| A database `Permission` catalog table                 | Keep `PERMISSION_CATALOG` in code and store validated permission keys directly in organization-scoped `RolePermission` rows, without a foreign key to a permission table.                                                                                                      | Permissions are application capabilities deployed with code. This avoids migration/seeding-order hazards and matches the repository's static jurisdiction-catalog pattern.    |
| A `STAFF` system role                                 | Retire `STAFF` and seed eight roles per organization: OWNER, ADMIN, ACCOUNTANT, SALES, PURCHASES, INVENTORY_MANAGER, PROJECT_MANAGER, and VIEWER. VIEWER (“Viewer/Auditor”) inherits the former read-only staff baseline and additionally receives report and audit viewing.   | Named module roles provide stable future attachment points. A single ambiguous staff bucket would need another disruptive split when those modules arrive.                    |

## Consequences

- Route links, tests, and documentation must use the established flat web paths. A route restructure is
  a separate migration decision, not implicit Phase 1 cleanup.
- No code may use floating-point arithmetic for monetary values. New modules resolve currency
  precision from the currency catalog and system accounts through stable system keys.
- Onboarding may change its presentation, but the section-scoped service contract and atomic
  finalization remain the authoritative workflow boundary.
- Country packs and tax codes are configurable software defaults, not jurisdictional certification.
  A future tax-regime model needs its own ADR and migration.
- New permissions are added to the code catalog and validated before `RolePermission` writes. There
  is no compatibility `Permission` table to keep synchronized.
- New organizations always receive their own copies of all eight system roles. UI role selectors use
  the API role catalog; they do not hardcode enums or reintroduce `STAFF` aliases.
