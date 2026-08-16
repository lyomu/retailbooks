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
4. Run `npm.cmd run dev`.
5. Open `http://localhost:3000`; API health is at `http://localhost:3001/health`.

Mailpit is available at `http://localhost:58025`; MinIO Console is at
`http://localhost:59001`.

## Verification

```text
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
docker compose config
```

RetailBooks is currently an implementation project, not a certified accounting, tax, or statutory
compliance service. Country packs encode configurable defaults and validation rules; professional
review remains required before production use in any jurisdiction.
