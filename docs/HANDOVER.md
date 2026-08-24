# Handover Prompt — RetailBooks Global Accounting Platform

**Project:** `c:\Users\gmnyo\Desktop\Engineering projects\retailbooks` — a multi-tenant, global,
double-entry accounting & invoicing web platform (monorepo: `apps/api` NestJS, `apps/web` Next.js,
`packages/*` shared libs).

## 1. Orient yourself first

Before writing any code, read these in order:

1. `docs/BUILD_ROADMAP.md` — the master 14-phase task checklist. Its Phase 2 section is a rolled-up
   summary; `docs/PHASE2_TODO.md` (below) is the detailed, authoritative record.
2. `docs/PHASE2_TODO.md` — milestone-by-milestone record for Phase 2 (Sales), same style as
   `PHASE1_TODO.md`. **This is the single most important file to read next** — it has an implementation
   note under every completed milestone with exact file paths, patterns reused, and what each
   milestone's tests actually prove.
3. `docs/PHASE1_TODO.md` and `docs/adr/000*` — Phase 1 detail and architecture decisions (tenancy,
   auth, roles/permissions, ledger, tax engine). Still load-bearing context for Phase 2 work.
4. `starter/global_accounting_platform_build_specification_v1.docx` and
   `starter/global_accounting_platform_master_blueprint.docx` — original specs, for exact
   field/rule/state definitions when a checklist item is ambiguous.

## 2. Current state (as of 2026-08-24)

**Phase 1 (Foundation) is fully complete**, including hardening: identity, tenant-isolation,
authorization-boundary, accounting-invariant/idempotency/concurrency, and end-to-end-journey tests are
all done. What's left in Phase 1 (visual regression baselines, WCAG review, performance review,
audit-log coverage review, backup/restore drill, threat model/dependency review, `DESIGN.md` update) is
**intentionally deferred** per the project's own "verification pass can wait" policy — it does not block
Phase 2 and should not be picked up unless asked.

**Phase 2 (Sales) is in progress.** Milestones 2A–2D's backend are done and committed; 2D's UI is the
immediate next task. Milestones 2E–2K have not been started.

| Milestone                                                 | Status                              |
| --------------------------------------------------------- | ----------------------------------- |
| 2A — Document numbering generalization                    | ✅ Done                             |
| 2B — Customers/Contacts                                   | ✅ Done (backend + UI)              |
| 2C — Catalog (Items/Units/Categories)                     | ✅ Done (backend + UI)              |
| 2D — Invoices (posting slice)                             | ⚠️ **Backend done, UI not started** |
| 2E — Payments Received + allocation                       | ⬜ Not started                      |
| 2F — Credit Notes                                         | ⬜ Not started                      |
| 2G — Quotes + Sales Orders                                | ⬜ Not started                      |
| 2H — PDF generation + email delivery                      | ⬜ Not started                      |
| 2I — Recurring Invoices                                   | ⬜ Not started                      |
| 2J — Customer Statements                                  | ⬜ Not started                      |
| 2K — Phase 2 verification pass (hard gate before Phase 6) | ⬜ Not started                      |

Full detail for each done milestone — exact models, permission keys, test names, and what was proven —
is in `docs/PHASE2_TODO.md`. Recent commits, in order:

```
a6674ab Add Catalog module: items, services, units, categories (Milestone 2C)
40812d6 Add Customers/Contacts module (Milestone 2B)
213a4ce Apply prettier formatting to Part A files
af038b4 Generalize document numbering for Phase 2 (Milestone 2A)
2dc97bf Add Phase 2 (Sales) milestone tracker
8048060 Complete Phase 1 end-to-end browser journeys and sync hardening status
5b41681 Add invoice posting backend (Milestone 2D, backend only)   <- most recent
```

## 3. Immediate next step: finish Milestone 2D's UI

The backend for invoice posting is done, tested (6 integration tests proving balanced multi-tax-code
posting, illegal-transition rejection, idempotent replay, competing-key races, and exact-reversal void —
see `apps/api/test/invoices.int.test.ts`), and committed. **What's missing is the UI.**

Build, following the exact pattern already established by `apps/web/src/components/customers-workbench.tsx`
and `apps/web/src/components/catalog-workbench.tsx` (both single-page list + inline create/edit forms
using `DataTable`/`EmptyState`/`ForbiddenState`/`Card` from `@retailbooks/ui`, gated by `hasPermission()`):

- `apps/web/src/components/invoices-workbench.tsx` — list with status filter, a line editor (item
  picker with free-text fallback, quantity/price/discount/tax-code per line, live subtotal preview),
  and a detail/edit view with **Issue** and **Void** actions gated by `sales.invoices.issue` /
  `sales.invoices.void`. The line editor should mirror the journal editor's live-balance-preview UX
  (`apps/web/src/components/ledger-workbench.tsx`) rather than the simpler catalog form, since invoices
  have multiple lines with running totals.
- `apps/web/src/app/invoices/page.tsx` — thin route wrapper, same pattern as
  `apps/web/src/app/customers/page.tsx`.
- Add an "Invoices" nav item to the `Sales` group in `apps/web/src/components/app-shell.tsx` (already
  has `Customers` and `Items & services`; add `Invoices` alongside them).
- The API surface is already there: `GET/POST /organizations/:id/invoices`,
  `GET/PATCH /organizations/:id/invoices/:invoiceId`, `POST .../issue`, `POST .../void`. Response/DTO
  shapes are in `packages/contracts/src/index.ts` under `// --- Sales: Invoices ---`
  (`invoiceSchema`, `createInvoiceDto`, `updateInvoiceDto`, etc.) — already typechecked and exported.

**When the UI is done:**

1. `npm run build --workspace @retailbooks/web` to confirm the new route builds.
2. Manually exercise the golden path in a browser (start infra + dev servers, create a customer and an
   item first, then draft → issue → void an invoice) — this repo's conventions require UI changes to be
   browser-tested, not just typechecked.
3. Flip Milestone 2D's UI bullet in `docs/PHASE2_TODO.md` to `[x]` with a short implementation note
   (matching the style of every other completed milestone in that file), and mark the milestone header
   ✅.
4. Run the full verification sequence in §6 below and commit.

## 4. Non-negotiable conventions

(Full list in `docs/BUILD_ROADMAP.md`'s "Platform-wide contracts" section.)

- Every tenant-owned table row carries `organization_id`; enforce scoping in the service + guard layer,
  never trust it from client input.
- Money is **always** fixed-precision integer minor units (`BigInt`) — never floating point. Reuse
  `packages/accounting-core` (`roundHalfUpDivide`, `taxAmountExclusive`, `splitInclusiveAmount`, etc.)
  for money/tax/FX math.
- Posted ledger records are immutable — corrections happen via reversal, never edits. **Never hand-roll
  posting logic.** Reuse `LedgerService` (`apps/api/src/organizations/ledger.service.ts`):
  - `accountBySystemKey(organizationId, systemKey, client?)` to resolve control accounts
    (`accounts_receivable`, `sales_revenue`, `tax_payable`, etc.) — never match on account code/name.
  - `postJournalFromLines(context, user, operation, input, metadata, idempotencyKey?, externalTx?)` —
    the programmatic posting path added in Milestone 2D for modules that build journal lines themselves
    rather than a human drafting one through the journals UI. Pass `externalTx` (and
    `idempotencyKey: undefined`) when your own transaction already owns idempotency at a higher level
    (see `InvoicesService#issueInvoice` for the reference implementation).
  - `reverseJournal(..., externalTx?)` — same `externalTx` pattern, for atomic void/correction flows.
- `TaxService.resolveForPosting(tx, organizationId, taxCodeId, baseAmountMinor, asOfDate)` — the
  transaction-safe way to freeze a tax snapshot as part of a larger posting transaction (added in 2D;
  `TaxService.calculate()` is the older, non-transactional preview-only sibling).
- Every financial mutation needs an audit event (`writeAuditEvent`, inside the same transaction as the
  mutation it describes).
- Every critical screen needs loading/empty/error/no-permission/archived-void/success states — reuse
  `packages/ui`'s `EmptyState`/`ForbiddenState`/`Skeleton`/`Toast` primitives.
- New Zod schemas go in `packages/contracts/src/index.ts` (flat file, grouped by `// --- Section ---`
  comments), shared by API and web.
- **Every new permission key must land in three places, or the web typecheck will silently miss it
  until someone tries to use it:**
  1. `apps/api/src/organizations/permission-catalog.ts` (`PERMISSION_KEYS` + `PERMISSION_CATALOG` entry)
  2. `apps/api/src/organizations/roles-catalog.ts` (role wiring)
  3. `packages/contracts/src/index.ts`'s `permissionKeySchema` enum — **this one is the easy miss**; it
     happened once already during 2C and was only caught because the web app's typecheck failed.
- Any new controller needs a matching entry in `apps/api/test/authorization-boundary.int.test.ts`'s
  `ENDPOINTS` array (and a `.replace(':yourParam', ID)` in `requestEndpoint` if it introduces a new
  route param) — the test's own first assertion (`keeps the declared matrix synchronized...`) will fail
  loudly if you forget.

## 5. Build/test sequencing — build first, verify in a follow-up pass

Within a phase, implement **Data model → Backend/API → UI → Business rules** before working through
that phase's **Tests/acceptance** checklist. Two things do **not** get deferred:

- **Money-invariant checks as you build the posting logic itself**: posting always balances, reversal
  is exact, payment/credit allocation can never over-apply. Write these alongside the implementation.
  Every Sales milestone so far has shipped its own money-invariant integration tests in the same commit
  as the feature (see `apps/api/test/{customers,catalog,invoices}.int.test.ts`) — keep that pattern.
- **A phase's `Tests/acceptance` checklist must be fully checked off before a later dependent phase
  starts building on it** — Milestone 2K is an explicit hard gate: nothing in Phase 6 (Inventory) may
  build on unverified Phase 2 posting.

Visual regression, WCAG, performance, and similar can genuinely wait for a dedicated verification pass.

## 6. Verification checklist before considering any task done

1. `npx tsc --noEmit` in the workspace(s) you touched, then `npm run typecheck` at the repo root.
2. `npm run lint` at the repo root (`eslint . --max-warnings=0`).
3. `npx prettier --write <changed files>` then `npm run format:check`.
4. `npm test` and `npm run test:integration` in `apps/api` (infra must be up: `npm run infra:up` at
   repo root — Postgres :55432, Redis :56379, MinIO, Mailpit; already running in this environment as
   Docker containers `retailbooks-{postgres,redis,minio,mailpit}-1`).
5. **Migration drift check**, if you touched `schema.prisma`. `psql` is not on PATH in this shell's
   bash tool — go through the Postgres container directly:
   ```
   docker exec retailbooks-postgres-1 psql -U retailbooks -d postgres -c 'DROP DATABASE IF EXISTS retailbooks_shadow_check' -c 'CREATE DATABASE retailbooks_shadow_check'
   cd apps/api && npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "postgresql://retailbooks:retailbooks@localhost:55432/retailbooks_shadow_check" --exit-code
   docker exec retailbooks-postgres-1 psql -U retailbooks -d postgres -c 'DROP DATABASE retailbooks_shadow_check'
   ```
6. `npm run build` at the repo root (both API and web must compile in production mode).
7. Update `docs/PHASE2_TODO.md` for the milestone you closed (check off items, add a short
   implementation note citing test file names — match the style already used for 2A–2D), then sync
   `docs/BUILD_ROADMAP.md`'s Phase 2 section if its rolled-up summary needs it.
8. Commit with a message that explains _why_, not just _what_ (see the 2D commit for the level of detail
   expected — it explains the `externalTx` design decision and why it was needed, not just "add
   invoices").

## 7. Known environment quirks worth knowing before you hit them

- **Prisma client generation can fail with `EPERM` on Windows** if a previous `npm run start`/test run
  left an orphaned `node dist/src/main.js` process holding the query-engine DLL open. If
  `npx prisma generate` or `migrate dev` fails this way, find it via
  `powershell -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\""`, confirm it's a
  retailbooks process (its loaded modules include `node_modules\.prisma\client\query_engine-windows.dll.node`),
  and stop it — **ask the user first**, this is a destructive action.
- **The web production build bakes `NEXT_PUBLIC_API_URL` in at build time**, not runtime — Next.js
  inlines `NEXT_PUBLIC_*` vars into the client bundle during `next build`. If you rebuild `apps/web` for
  a different target (e.g. the E2E harness's `:3401` API vs. normal dev's `:3001`), the _next_ plain
  `npm run build --workspace @retailbooks/web` you run afterward will silently revert to whatever
  `apps/web/.env.local` says. Rebuild once more with normal env before resuming ordinary local dev if
  you've been running the E2E suite.
