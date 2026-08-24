# RetailBooks

RetailBooks is a multi-tenant accounting operations platform for growing businesses. Phase 1
establishes the audit-safe accounting foundation: identity, organizations, roles, localization,
fiscal periods, numbering, double-entry journals, tax configuration, and the first operational
web surfaces.

The product uses the RetailFlow web application as its explicit visual authority while keeping a
separate RetailBooks identity and accounting-focused information architecture.

## Workspace

- `apps/web` — Next.js web application
- `apps/api` — NestJS API
- `packages/ui` — shared RetailBooks interface primitives
- `packages/contracts` — shared API schemas and types
- `packages/accounting-core` — deterministic accounting rules
- `packages/localization` — country-pack contracts and Kenya defaults
- `packages/config` — shared tooling configuration
- `packages/test-utils` — shared test fixtures and helpers
- `infrastructure` — local service initialization files
- `docs/PHASE1_TODO.md` — accepted implementation checklist and source of progress truth

## Local start

1. Copy `.env.example` to `.env`.
2. Run `npm.cmd install` on Windows (`npm install` elsewhere).
3. Run `docker compose up -d`.
4. Run `npm.cmd run db:deploy --workspace @retailbooks/api`.
5. Run `npm.cmd run dev`.
6. Open `http://localhost:3000`; API health is at `http://localhost:3001/api/v1/health`.

Mailpit is available at `http://localhost:58025`; MinIO Console is at
`http://localhost:59001`.

Identity routes are available at `/signup`, `/login`, `/verify-email`, `/forgot-password`, and
`/reset-password`. Mailpit captures verification and reset messages locally. Set a strong,
environment-specific `SECURITY_PEPPER` before using non-local environments.

## Verification

```text
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:integration
npm.cmd run build
docker compose config
```

`npm test` is the fast, DB-free suite and needs no running infrastructure.
`npm run test:integration` boots the real API against PostgreSQL and requires
`docker compose up -d`; it creates and migrates a dedicated `retailbooks_test`
database, leaving the development database untouched. Integration specs are
named `*.int.test.ts`.

RetailBooks is currently an implementation project, not a certified accounting, tax, or statutory
compliance service. Country packs encode configurable defaults and validation rules; professional
review remains required before production use in any jurisdiction.
