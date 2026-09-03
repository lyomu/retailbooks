-- `project_budgets.task_id` becomes required.
--
-- The unique tuple `(project_id, task_id)` was not a real constraint while the column was nullable:
-- PostgreSQL treats NULLs as distinct, so unlimited project-level rows could accumulate behind an
-- index that looked like it forbade them. Work not attached to a task is budgeted by
-- `projects.budget_amount_minor` / `projects.budget_hours`, which already exist.
--
-- No rows are deleted. The column shipped one migration ago and nothing writes NULL to it, so if a
-- NULL exists this statement should fail loudly rather than quietly discard a budget.
ALTER TABLE "project_budgets" ALTER COLUMN "task_id" SET NOT NULL;
