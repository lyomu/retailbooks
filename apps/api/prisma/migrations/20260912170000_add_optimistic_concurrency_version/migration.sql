-- GAPS #35: Add optimistic concurrency version counters to high-risk financial records
-- beyond the ledger. These drive stale-write detection on mutable updates.

ALTER TABLE "invoices"      ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "credit_notes"  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "quotes"        ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "purchase_orders" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "bills"         ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "expenses"      ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
