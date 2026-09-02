# RetailBooks query performance — rules, budgets, and evidence

**Established:** 2026-09-02, at execution-plan Stage 4.1. **Binds:** every read path that produces a
total, a balance, or a report row — which from Phase 9 onward is roughly thirty reports across nine
families.

This file exists because of a specific risk (`EXECUTION_PLAN.md` R4): `LedgerService.trialBalance`
loaded every posted journal line into Node and reduced it in JavaScript. That is survivable for one
report on a demo organization and fatal as the foundation of a report engine. The pattern below
replaced it, and is the pattern Phase 9 inherits.

---

## Rule 1 — Aggregate in the database, not in Node

A query that produces a sum, a count, or a per-group total uses `groupBy`, `aggregate`, or a raw
CTE. It does **not** `findMany` and reduce.

The row count that crosses the database boundary must be bounded by something that does not grow
with transaction history. For the ledger that bound is the account count; for a document list it is
an explicit `take`. Posted history only ever grows, so any read whose cost scales with it will fail
in production and pass every test written against a demo organization.

**Reference implementation:** `LedgerService.postedMovementByAccount` and
`LedgerService.postedBalance` (`apps/api/src/organizations/ledger.service.ts`). Four call sites use
them — `trialBalance`, `listAccounts`, `accountLedger`'s opening balance, and the post-update
account balance. Copy this shape rather than inventing a second one.

## Rule 2 — Scope the tenant on both sides of a relation filter

This one is not obvious and cost real query time to find.

Writing `journalLine.groupBy({ where: { organizationId, journal: { status, journalDate } } })` puts
the tenant predicate only on `journal_lines`. Prisma compiles the relation filter to a `LEFT JOIN`,
and with nothing restricting the `journals` side, PostgreSQL sequentially scans **every tenant's**
journals and hash-joins them against a sequential scan of the whole line table — no index is used
on either side, and a one-month report reads the entire history of every organization on the
instance.

Repeating `organizationId` inside the relation filter is therefore not redundant. It is what lets
the planner use `journals(organization_id, status, journal_date)` and `journal_lines(organization_id,
journal_id)`. `postedJournalFilter()` does this centrally so no call site has to remember.

Any new relation-filtered aggregate in Phases 7–9 must do the same.

## Rule 3 — No unbounded query

Every query is bounded by `organizationId` **and** either an explicit `take` or a date/status
predicate. A list endpoint without a `take` is a defect, not a nicety — the audit log's keyset
cursor (`audit-log-cursor.ts`) is the pattern for unbounded append-only tables.

---

## Measured evidence

Method: a scratch `retailbooks_perf` database migrated from `prisma/migrations`, seeded with two
tenants × 60 accounts × 150,000 journals × 2 lines = **600,000 journal lines**, then `ANALYZE`d.
SQL captured from Prisma's query event log so the plans are of what the ORM actually emits, not of
a hand-written approximation. Re-creating this is described under "Re-checking" below.

### Aggregate versus reduce — full trial balance, one tenant (285,000 posted lines)

| Shape                                 | Rows returned to Node | Wall clock |
| ------------------------------------- | --------------------- | ---------- |
| `findMany` + JS reduce (the old code) | 285,000               | 7,522 ms   |
| `groupBy` (the new code)              | 60                    | 209 ms     |

Roughly 36× faster, and 4,750× fewer rows across the boundary. The gap grows linearly with posted
history; the aggregate's return size does not grow at all.

### Tenant scoping — one-month trial balance

| Journal filter                    | Plan                                            | Line rows scanned |
| --------------------------------- | ----------------------------------------------- | ----------------- |
| `organizationId` on the line only | parallel hash join, seq scan on **both** tables | 300,000           |
| `organizationId` on both sides    | nested loop over two index scans                | 8,016             |

Execution time differed by only ~13 ms at this size (55 ms → 42 ms), which is the trap: at demo
scale the wrong plan looks fine. What matters is that the first plan's cost is set by total table
size and tenant count, and the second's by the date range asked for.

The indexes that carry the good plan already existed; nothing was added at Stage 4.1:

- `journals(organization_id, status, journal_date)`
- `journals(organization_id, journal_date)`
- `journal_lines(organization_id, journal_id)`
- `journal_lines(organization_id, account_id)`

---

## Budgets for Phases 7–9

1. No ledger or report query returns more rows to Node than the account count, the page `take`, or
   the report's own row count — whichever the report legitimately renders.
2. Every report query's plan is index-driven for a bounded period. A sequential scan is acceptable
   only where the query genuinely selects most of the table (a full-history export, say) — and then
   it belongs on the streaming/queued path, not in a request.
3. Phase 9's large-report path streams or queues rather than building the result in request memory
   (`EXECUTION_PLAN.md` §9B).
4. `trialBalance` is ported onto the Phase 9 engine, not reimplemented beside it (§9C Batch 1).

## Re-checking

The scratch database is disposable and is not part of the test suite — a 600k-row seed is too slow
for CI, and the plans only need re-checking when a read path or an index changes. To redo it:

```sh
docker compose exec -T postgres psql -U retailbooks -d postgres \
  -c 'CREATE DATABASE retailbooks_perf'
cd apps/api && DATABASE_URL=postgresql://retailbooks:retailbooks@localhost:55432/retailbooks_perf \
  npx prisma migrate deploy
```

Then seed with `generate_series` (two tenants matter — with one, the missing tenant predicate is
invisible), `ANALYZE`, and run `EXPLAIN (ANALYZE, BUFFERS)` on the SQL captured from a
`PrismaClient({ log: [{ emit: 'event', level: 'query' }] })`. Explain the emitted SQL, never a
paraphrase of it: the `LEFT JOIN` that caused Rule 2 does not appear in the Prisma call.

Drop `retailbooks_perf` afterwards. It is never the target of `npm run test:integration`, which
uses `retailbooks_test`.
