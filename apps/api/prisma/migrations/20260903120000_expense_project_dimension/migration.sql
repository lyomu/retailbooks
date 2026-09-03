-- Expenses gain a project dimension, chosen before the expense posts.
--
-- Without it nothing ever wrote an expense-side dimensioned journal line, so project profitability
-- reported cost as zero and margin as equal to revenue on every project. `ProjectExpense` could not
-- close the gap: it requires an already-posted expense, and decision D1 forbids re-stamping a
-- posted line. The attribution has to be made before the journal is frozen, so it lives here.
--
-- Nullable with no backfill, for the same reason `journal_lines` was: expenses recorded before
-- projects existed have no project, and a null says that honestly.
ALTER TABLE "expenses" ADD COLUMN "project_id" UUID;

CREATE INDEX "expenses_organization_id_project_id_idx" ON "expenses"("organization_id", "project_id");

ALTER TABLE "expenses" ADD CONSTRAINT "expenses_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
