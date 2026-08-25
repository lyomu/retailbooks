-- CreateEnum
CREATE TYPE "OpeningBalanceBatchStatus" AS ENUM ('DRAFT', 'VALIDATED', 'FINALIZED', 'VOID');

-- CreateEnum
CREATE TYPE "OpeningBalancePartySide" AS ENUM ('RECEIVABLE', 'PAYABLE');

-- AlterTable
ALTER TABLE "journals" ADD COLUMN     "posting_rule" VARCHAR(120);

-- CreateTable
CREATE TABLE "opening_balance_batches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "status" "OpeningBalanceBatchStatus" NOT NULL DEFAULT 'DRAFT',
    "as_of_date" DATE NOT NULL,
    "description" VARCHAR(240),
    "journal_id" UUID,
    "validated_at" TIMESTAMPTZ(6),
    "finalized_at" TIMESTAMPTZ(6),
    "finalized_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opening_balance_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opening_balance_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "debit_minor" BIGINT NOT NULL DEFAULT 0,
    "credit_minor" BIGINT NOT NULL DEFAULT 0,
    "description" VARCHAR(240),

    CONSTRAINT "opening_balance_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opening_balance_party_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "side" "OpeningBalancePartySide" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "name_snapshot" VARCHAR(160) NOT NULL,
    "contact_id" UUID,
    "vendor_id" UUID,

    CONSTRAINT "opening_balance_party_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "opening_balance_batches_journal_id_key" ON "opening_balance_batches"("journal_id");

-- CreateIndex
CREATE INDEX "opening_balance_batches_organization_id_status_idx" ON "opening_balance_batches"("organization_id", "status");

-- CreateIndex
CREATE INDEX "opening_balance_batches_organization_id_as_of_date_idx" ON "opening_balance_batches"("organization_id", "as_of_date");

-- CreateIndex
CREATE INDEX "opening_balance_lines_organization_id_batch_id_idx" ON "opening_balance_lines"("organization_id", "batch_id");

-- CreateIndex
CREATE INDEX "opening_balance_party_lines_organization_id_batch_id_idx" ON "opening_balance_party_lines"("organization_id", "batch_id");

-- CreateIndex
CREATE INDEX "opening_balance_party_lines_organization_id_side_idx" ON "opening_balance_party_lines"("organization_id", "side");

-- AddForeignKey
ALTER TABLE "opening_balance_batches" ADD CONSTRAINT "opening_balance_batches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_balance_batches" ADD CONSTRAINT "opening_balance_batches_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "journals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_balance_batches" ADD CONSTRAINT "opening_balance_batches_finalized_by_user_id_fkey" FOREIGN KEY ("finalized_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "opening_balance_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_balance_party_lines" ADD CONSTRAINT "opening_balance_party_lines_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "opening_balance_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_balance_party_lines" ADD CONSTRAINT "opening_balance_party_lines_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_balance_party_lines" ADD CONSTRAINT "opening_balance_party_lines_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

