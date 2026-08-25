-- CreateTable
CREATE TABLE "fx_revaluation_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "as_of_date" DATE NOT NULL,
    "base_currency" CHAR(3) NOT NULL,
    "journal_id" UUID NOT NULL,
    "gain_minor" BIGINT NOT NULL DEFAULT 0,
    "loss_minor" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID NOT NULL,

    CONSTRAINT "fx_revaluation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fx_revaluation_runs_journal_id_key" ON "fx_revaluation_runs"("journal_id");

-- CreateIndex
CREATE INDEX "fx_revaluation_runs_organization_id_created_at_idx" ON "fx_revaluation_runs"("organization_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "fx_revaluation_runs_organization_id_as_of_date_key" ON "fx_revaluation_runs"("organization_id", "as_of_date");

-- AddForeignKey
ALTER TABLE "fx_revaluation_runs" ADD CONSTRAINT "fx_revaluation_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fx_revaluation_runs" ADD CONSTRAINT "fx_revaluation_runs_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fx_revaluation_runs" ADD CONSTRAINT "fx_revaluation_runs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

