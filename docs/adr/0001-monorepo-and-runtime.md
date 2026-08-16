# ADR 0001: TypeScript monorepo and portable runtime

- **Status:** Accepted
- **Date:** 2026-08-16

## Context

RetailBooks needs a web application, an API, reusable accounting rules, country packs, UI
components, and shared contracts. The implementation should be easy to run locally and avoid an
early dependency on one cloud provider.

## Decision

Use npm workspaces with a TypeScript-first repository:

- Next.js for the web application
- NestJS for the API
- PostgreSQL as the source-of-truth relational database
- Redis for ephemeral coordination and rate-limit/session support
- S3-compatible object storage for document artifacts
- SMTP-compatible email delivery
- Docker Compose for local PostgreSQL, Redis, MinIO, and Mailpit

Domain rules that can be deterministic and infrastructure-independent live in shared packages.
Persistence and transport concerns remain in the API.

## Consequences

- Shared types and rules can evolve atomically with applications.
- Local development exercises the same infrastructure contracts expected in production.
- Workspace-wide verification is straightforward, but package boundaries must be maintained to
  prevent accidental framework coupling.
