# ADR 0011: Threat model and secret handling for the import and storage surfaces

- Status: Accepted
- Date: 2026-09-02

## Context

Execution-plan Stage 4.4 scopes a security review to what Phase 5 introduced and what Phases 8 and
9 will build on: **untrusted file input**. Banking added statement upload and a hand-rolled CSV
parser; Purchases added attachment upload to object storage. Phase 8 adds country-pack import and
Phase 9 adds report export, both on the same foundations. A review is cheaper now than after three
more import paths exist.

This is deliberately not a full STRIDE pass over the platform. Identity, session, and tenancy
threats were modelled in ADRs 0003 and 0004 and are proven by `identity-tenancy.int.test.ts` and
`authorization-boundary.int.test.ts`; the authorization boundary is now derived from the Nest module
graph, so a new controller cannot ship uncovered. Those are not re-litigated here.

The production-readiness checklist and dependency-review process remain Phase 14 work
(`PHASE1_TODO.md`, Stage 4.5–4.8).

## Findings

Each finding is **guarded**, **gap**, or **fixed here**. Anything not fixed in this commit names
where it goes.

### 1. Statement import and CSV parsing

| Aspect              | State                                                                                                                                                                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Row count           | **Guarded.** `MAX_ROWS = 5_000`, rejected with a clear message.                                                                                                                                                                                                                                                          |
| File size           | **Fixed here.** There was no byte ceiling anywhere on the path: `FileInterceptor('file')` carried no `limits`, so multer buffered an arbitrarily large body, which was then `toString('utf8')`-ed and fully parsed _before_ the row cap could fire. Now bounded at 8MB at the interceptor and re-checked in the service. |
| Parser resource use | **Guarded, by construction.** `parseCsv` is a single forward pass with no backtracking and no regex over the input, so there is no catastrophic-backtracking surface. Its cost is linear in input length, which the byte ceiling now bounds.                                                                             |
| Encoding            | **Guarded.** UTF-8 with an explicit BOM strip. This is where the Stage 0 lint error lived — the BOM character had been written literally into the regex — so the behaviour is now both correct and legible.                                                                                                              |
| Archive/compression | **Not applicable.** No archive or compressed upload is accepted, so there is no decompression-bomb surface. Adding one in Phase 8 would reopen this row.                                                                                                                                                                 |
| Cell content        | **Gap, accepted for now.** Cell values are parsed as data and never evaluated, and every downstream write is a parameterised Prisma call, so there is no injection into the database. What is _not_ handled is spreadsheet formula injection on the way back out — see 4 below.                                          |

### 2. Object storage and attachments

| Aspect              | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Size                | **Fixed here.** The 15MB service check ran only after multer had already buffered the whole file. The interceptors now carry the same limit, so an oversized body is refused mid-stream. The service check stays as the authoritative one — an interceptor limit is transport configuration, and a caller could reach the service another way.                                                                                                                                                                                       |
| Tenant scoping      | **Guarded.** Keys are prefixed `"{organizationId}/{entityType}/{entityId}/{uuid}-…"` and reads resolve through an organization-scoped row, so a key is never taken from the client.                                                                                                                                                                                                                                                                                                                                                  |
| Key construction    | **Fixed here.** The client's `originalname` was interpolated into the key raw. S3 and MinIO treat a key as an opaque string rather than a path, so `../` did not escape the tenant prefix — but that is a property of the current backend, not of the code, and it stops holding the moment a key builds a filesystem path (a local export, a backup restore, a future filesystem driver). `safeKeySegment()` now constrains the key; the `filename` column keeps the original for display.                                          |
| Content type        | **Gap.** `file.mimetype` is client-supplied, stored, and returned on download, and there is no allowlist. Combined with signed URLs served from the storage origin, a stored `text/html` attachment is a plausible stored-XSS vector depending on how the origin serves it. **Follow-up:** add an allowlist (PDF, common images, CSV, plain text) and force a download disposition. Sized at under an hour; belongs with the next attachment work rather than in a review commit, because it changes what existing users can upload. |
| Signed URL lifetime | **Guarded.** One hour by default, and generated per request rather than persisted.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Error status        | **Fixed here.** The shared exception filter had no mapping for 413, so an oversized upload reported `INTERNAL_ERROR`. It now reports `PAYLOAD_TOO_LARGE`.                                                                                                                                                                                                                                                                                                                                                                            |

### 3. Secret handling

| Aspect                     | State                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Secrets in version control | **Guarded and verified.** `.gitignore` covers `.env` and `.env.local` at any depth; `git ls-files` confirms `.env.example` is the only tracked env file.                                                                                                                                                                                                                                 |
| `SECURITY_PEPPER`          | **Guarded.** Falls back to a development value, and `AuthService` refuses to construct in production if it is shorter than 32 characters — a startup failure rather than a silently weak pepper.                                                                                                                                                                                         |
| Other required secrets     | **Gap.** The pepper is the only value with a startup assertion. `DATABASE_URL`, `REDIS_URL`, and the `S3_*` credentials all fall back to `?? ''` or a localhost default, so a production boot with a missing secret starts and fails later at first use, in a request, rather than at startup.                                                                                           |
| Typed configuration        | **Gap.** `packages/config` is a stub — a `package.json` and a `README.md`, no source. Env access is ad hoc `process.env` in about thirteen places. **Follow-up:** give the package a schema that validates the full environment once at boot and exposes typed getters, which closes the row above with it. Best done at the start of Phase 8, which adds its own configuration surface. |
| Cookies                    | **Guarded.** `httpOnly`, `sameSite`, and `secure` gated on `NODE_ENV === 'production'`.                                                                                                                                                                                                                                                                                                  |
| Log redaction              | **Guarded.** Pino redacts `authorization`, `cookie`, `set-cookie`, `body.password`, and `body.token`; `redactUrl` additionally strips `token`/`code`/`secret`/`password`/`key` from query strings, because a logged verification token is a usable one and Pino's `redact` only walks object paths.                                                                                      |
| IP handling                | **Guarded.** IP addresses are stored only as `ipHash`, peppered.                                                                                                                                                                                                                                                                                                                         |
| Demo seed                  | **Guarded.** Refuses to run in production without an explicit `ALLOW_DEMO_SEED=true`.                                                                                                                                                                                                                                                                                                    |

### 4. Deferred, with reasons

- **CSV export formula injection.** A cell beginning `=`, `+`, `-`, or `@` is executed by Excel and
  Sheets on open. RetailBooks does not export CSV yet — Phase 9 §9B is the first time it will, and
  it will export exactly the untrusted strings imported here. The mitigation (prefix such cells with
  an apostrophe) belongs in the export writer, so it is recorded as a Phase 9 requirement rather
  than implemented against a writer that does not exist.
- **`npm audit` in CI.** Not currently run. Worth adding, but it needs a triage policy for
  unfixable transitive advisories first, or it becomes a permanently red step that trains everyone
  to ignore it. Goes with Phase 14's dependency review.
- **Rate limiting on upload endpoints.** Auth endpoints are Redis-rate-limited; upload endpoints are
  not. With byte and row ceilings now in place the per-request cost is bounded, so this is a
  capacity concern rather than a security one, and it belongs with the operational work in Phase 14.

## Decision

Fix in this commit what is a genuine unbounded-input path and cheap to close: byte ceilings on all
three upload endpoints, filename sanitisation in the storage key, and the missing 413 mapping.
Record the rest as sized follow-ups against the phase that will own the surrounding code, rather
than making a review commit carry behaviour changes that affect what users can already upload.

## Consequences

- The three upload endpoints now refuse an oversized body mid-stream. An over-limit upload returns
  **413 `PAYLOAD_TOO_LARGE`** rather than 400; `attachments.int.test.ts` asserts the new contract.
- Attachment object keys are now derived from a sanitised filename. Keys written before this change
  keep whatever form they had — nothing reads a key by reconstructing it, so no migration is needed.
- Two gaps are open and owned: the content-type allowlist, and environment validation at startup
  (which subsumes the missing-secret gap). Both are recorded in `PHASE1_TODO.md`.
