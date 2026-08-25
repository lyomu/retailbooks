-- CreateTable
CREATE TABLE "recurring_journal_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "memo" VARCHAR(240),
    "cadence" "RecurringCadence" NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "next_run_date" DATE NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "auto_post" BOOLEAN NOT NULL DEFAULT true,
    "last_run_occurrence_key" VARCHAR(100),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vendorId" UUID,

    CONSTRAINT "recurring_journal_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_journal_template_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "line_number" SMALLINT NOT NULL,
    "account_id" UUID NOT NULL,
    "debit_minor" BIGINT NOT NULL DEFAULT 0,
    "credit_minor" BIGINT NOT NULL DEFAULT 0,
    "description" VARCHAR(240),

    CONSTRAINT "recurring_journal_template_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recurring_journal_templates_organization_id_active_next_run_idx" ON "recurring_journal_templates"("organization_id", "active", "next_run_date");

-- CreateIndex
CREATE INDEX "recurring_journal_template_lines_organization_id_template_i_idx" ON "recurring_journal_template_lines"("organization_id", "template_id");

-- AddForeignKey
ALTER TABLE "recurring_journal_templates" ADD CONSTRAINT "recurring_journal_templates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_journal_templates" ADD CONSTRAINT "recurring_journal_templates_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_journal_templates" ADD CONSTRAINT "recurring_journal_templates_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_journal_template_lines" ADD CONSTRAINT "recurring_journal_template_lines_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "recurring_journal_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_journal_template_lines" ADD CONSTRAINT "recurring_journal_template_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_journal_template_lines" ADD CONSTRAINT "recurring_journal_template_lines_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

