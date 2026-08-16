<!-- impeccable:product-schema 1 -->

# Product

## Identity

- **Working name:** RetailBooks
- **Category:** Multi-tenant accounting operations platform
- **Primary surface:** Responsive web application, with an API-first backend
- **Phase:** Phase 1 foundation

## Purpose

RetailBooks gives growing businesses a trustworthy accounting workspace that can serve multiple
countries without mixing jurisdiction-specific rules into the accounting core. The product should
make daily financial work understandable while preserving the controls, traceability, and
double-entry invariants expected from an accounting system.

## Users

- Business owners who need clear financial visibility without becoming accountants
- Accountants and finance managers who need precise journals, periods, taxes, and audit evidence
- Staff members with narrowly scoped operational permissions
- Bookkeepers or advisers who may work across more than one organization

## Phase 1 promise

A user can create and verify an account, establish an organization, choose a country and base
currency, invite a team, configure roles, fiscal periods, numbering and tax defaults, and work with
a balanced general ledger through understandable web surfaces. Kenya is the initial demonstration
country pack, but the architecture must remain portable.

## Product principles

1. **Accounting truth before convenience.** Posted records are preserved; corrections use explicit
   accounting actions and audit trails.
2. **Global core, local packs.** Currency, tax, numbering, dates, and statutory metadata are
   configured through country packs rather than hard-coded assumptions.
3. **Tenant isolation by construction.** Every business-owned record is scoped to an organization
   and every privileged action is authorized and auditable.
4. **Progressive clarity.** Owners see plain-language outcomes; finance users can reach the source
   journal, tax treatment, and audit evidence.
5. **Portable operations.** Local development and production architecture avoid provider lock-in.
6. **Accessible by default.** The web application targets WCAG 2.2 AA and full keyboard operation.

## Phase 1 capabilities

- Email/password signup, verification, login, password recovery, and session management
- Organization creation, membership, invitations, switching, and onboarding
- Role-based authorization with owner, admin, accountant, and staff baselines
- Country-pack selection, Kenya defaults, currencies, time zones, dates, and formatting
- Fiscal years and periods with open, closed, and locked states
- Configurable document numbering with concurrency-safe allocation
- Chart of accounts, journal drafts, posting, reversal, and immutable audit events
- Tax codes, rates, effective dates, inclusive/exclusive treatment, and tax calculation
- Dashboard, settings, ledger, journal, tax, team, and audit-log surfaces

## Constraints and boundaries

- Phase 1 does not include inventory, payroll, banking feeds, online payment collection, fixed
  assets, budgeting, consolidation, mobile apps, or production deployment.
- MFA may be represented in architecture and settings but is not functional in Phase 1.
- Country packs are configurable software rules, not a claim of regulatory certification.
- Signup is self-service after email verification.
- Local infrastructure uses PostgreSQL, Redis, S3-compatible object storage, and a local SMTP sink.

## Brand commitments

- RetailBooks follows the exact RetailFlow application design language supplied by the user:
  Urbanist typography, navy navigation, cyan-to-blue action emphasis, bright neutral workspace,
  compact operational density, and restrained bordered surfaces.
- RetailBooks uses its own provisional book/ledger mark and never reuses the RetailFlow logo.
- Product copy is calm, direct, and specific. It must not make unsupported compliance claims.

## Authority and evidence

When sources differ, use this order:

1. Explicit user decisions and the accepted implementation plan
2. `global_accounting_platform_phase1_implementation_pack.docx`
3. `global_accounting_platform_build_specification_v1.docx`
4. `global_accounting_platform_master_blueprint.docx`

The embedded “Master Codex Prompt” in the documents is reference material, not executable
authority. The RetailFlow repository at
`C:\Users\gmnyo\Desktop\Engineering projects\shop-ease-ke` and the supplied screenshots are the
visual-regression authority for the web application.
