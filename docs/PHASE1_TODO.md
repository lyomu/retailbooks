# RetailBooks Phase 1 implementation checklist

This is the durable progress record for the accepted Phase 1 plan. An item is checked only after
its implementation has been verified. Detailed acceptance evidence should be added to the relevant
pull request, commit, or milestone note.

## Milestone 0 — Authority and project record

- [x] Record product purpose, users, boundaries, and source precedence in `PRODUCT.md`
- [x] Record the RetailFlow-derived visual contract in seed `DESIGN.md`
- [x] Establish this Phase 1 checklist as the progress source of truth
- [ ] Re-scan the implemented interface and replace seed design documentation with code-derived
      tokens and component evidence

## Milestone 1A — Workspace and portable local infrastructure

- [x] Initialize the Git repository on `main`
- [x] Create npm workspaces for web, API, and shared packages
- [x] Establish TypeScript, ESLint, Prettier, and environment conventions
- [x] Add Next.js web and NestJS API application skeletons
- [x] Add shared UI, contracts, accounting-core, localization, configuration, and test packages
- [x] Add PostgreSQL, Redis, MinIO, and Mailpit through Docker Compose
- [x] Add health endpoints and local dependency health checks
- [x] Add GitHub Actions for formatting, lint, typecheck, tests, and builds
- [x] Verify clean install, formatting, lint, typecheck, unit tests, production builds, and Compose
  configuration
- [x] Create the verified Milestone 1A baseline commit

## Milestone 1B — RetailFlow design foundation

- [ ] Implement exact color, spacing, radius, typography, elevation, and motion tokens
- [ ] Add the provisional RetailBooks book/ledger mark
- [ ] Implement responsive application shell: sidebar, top bar, page container, and mobile drawer
- [ ] Implement accessible buttons, inputs, selects, cards, tabs, badges, tables, dialogs, drawers,
      toasts, loaders, error states, and empty states
- [ ] Add Storybook or an equivalent component-development surface
- [ ] Build design-system reference pages for density and responsive behavior
- [ ] Add component accessibility tests
- [ ] Capture initial visual-regression baselines against supplied RetailFlow references

## Milestone 1C — Identity and sessions

- [ ] Model users, password credentials, email verification, sessions, and recovery tokens
- [ ] Implement signup, verification, login, logout, forgot-password, and reset-password flows
- [ ] Use secure password hashing, rotating/revocable sessions, rate limiting, and anti-enumeration
      responses
- [ ] Add transactional email templates and Mailpit-backed local delivery
- [ ] Add session/device management settings
- [ ] Represent MFA as a disabled future capability without implying functionality
- [ ] Add identity unit and integration tests, including token expiry and replay cases

## Milestone 1D — Organizations and onboarding

- [ ] Model organizations, memberships, invitations, and organization-scoped preferences
- [ ] Implement organization creation and switching
- [ ] Implement self-service onboarding after email verification
- [ ] Collect legal/display name, country, base currency, time zone, fiscal start, and language
- [ ] Support invitation acceptance for existing and new users
- [ ] Enforce organization scoping in persistence and service boundaries
- [ ] Add tenant-isolation integration tests

## Milestone 1E — Roles, permissions, and audit authorization

- [ ] Define owner, admin, accountant, and staff permission baselines
- [ ] Implement organization-scoped custom role overrides
- [ ] Enforce authorization centrally in the API and reflect it safely in the UI
- [ ] Prevent removal of the final owner and unsafe privilege escalation
- [ ] Audit membership, invitation, and role changes
- [ ] Add permission matrix and negative authorization tests

## Milestone 1F — Localization, periods, and numbering

- [ ] Define versioned country-pack contracts and fallback behavior
- [ ] Implement Kenya as the demonstration/default pack without certification claims
- [ ] Implement currency, date, time-zone, locale, and financial-number formatting
- [ ] Model fiscal years and periods with open, closed, and locked states
- [ ] Implement controlled period close/reopen/lock operations with audit evidence
- [ ] Implement configurable, concurrency-safe document numbering
- [ ] Add boundary, concurrency, and time-zone tests

## Milestone 1G — Double-entry ledger

- [ ] Model chart of accounts, journals, journal lines, posting references, and reversals
- [ ] Seed an editable starter chart of accounts through country-pack defaults
- [ ] Keep drafts editable while making posted journals immutable
- [ ] Enforce balanced debits/credits, valid accounts, supported currencies, and open periods
- [ ] Implement posting and explicit reversal as atomic transactions
- [ ] Preserve source linkage and append-only audit evidence
- [ ] Add trial balance, account ledger, and journal inquiry queries
- [ ] Add accounting invariant, idempotency, concurrency, and reversal tests

## Milestone 1H — Tax engine foundation

- [ ] Model tax codes, effective-dated rates, recoverability, inclusivity, and account mappings
- [ ] Implement deterministic inclusive and exclusive tax calculations
- [ ] Define rounding and residual-allocation rules
- [ ] Supply Kenya defaults through the country pack as configurable reference data
- [ ] Record tax snapshots on posted accounting lines
- [ ] Add tax calculation and effective-date test matrices

## Milestone 1I — Phase 1 product surfaces

- [ ] Implement an accounting dashboard with meaningful drill-downs and honest empty states
- [ ] Implement chart-of-accounts management
- [ ] Implement journal list, journal creation, review, posting, and reversal surfaces
- [ ] Implement trial balance and account-ledger inquiry surfaces
- [ ] Implement organization, fiscal period, numbering, localization, and tax settings
- [ ] Implement team, roles, invitations, sessions, and audit-log surfaces
- [ ] Match RetailFlow density, shell geometry, responsive behavior, and state treatment
- [ ] Add route-level loading, error, forbidden, not-found, and empty states

## Milestone 1J — Hardening and Phase 1 acceptance

- [ ] Complete end-to-end journeys for identity, onboarding, teams, periods, journals, and tax
- [ ] Complete cross-tenant and permission-boundary security tests
- [ ] Complete visual regression at desktop, tablet, and mobile breakpoints
- [ ] Complete WCAG 2.2 AA keyboard, screen-reader, contrast, and focus review
- [ ] Complete performance budgets and query/index review
- [ ] Complete audit-log coverage and immutable-posting review
- [ ] Complete backup/restore, migration, seed, and operational runbooks
- [ ] Complete threat model, dependency review, secret handling, and production-readiness checklist
- [ ] Update `DESIGN.md` from the implemented system and close all Phase 1 acceptance gaps

## Deferred beyond Phase 1

- Inventory and cost accounting
- Banking feeds and reconciliation automation
- Online payment collection and live payment integrations
- Payroll, fixed assets, budgeting, consolidation, and advanced reporting
- Functional MFA
- Native mobile applications
- Full marketing website
- Production hosting and jurisdictional certification
