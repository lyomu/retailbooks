-- CreateEnum
CREATE TYPE "FinancialAccountType" AS ENUM ('BANK', 'CASH', 'CREDIT_CARD', 'OTHER');

-- CreateEnum
CREATE TYPE "StatementImportFormat" AS ENUM ('CSV');

-- CreateEnum
CREATE TYPE "StatementImportStatus" AS ENUM ('IMPORTED', 'PARTIALLY_IMPORTED', 'FAILED');

-- CreateEnum
CREATE TYPE "BankTransactionDirection" AS ENUM ('INFLOW', 'OUTFLOW');

-- CreateEnum
CREATE TYPE "BankTransactionDisposition" AS ENUM ('UNRESOLVED', 'MATCHED', 'POSTED', 'EXCLUDED');

-- CreateEnum
CREATE TYPE "MatchTargetType" AS ENUM ('PAYMENT_RECEIVED', 'PAYMENT_MADE', 'EXPENSE', 'TRANSFER');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('POSTED', 'VOID');

-- CreateTable
CREATE TABLE "financial_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "type" "FinancialAccountType" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "gl_account_id" UUID NOT NULL,
    "opening_balance_minor" BIGINT NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_activity_at" TIMESTAMPTZ(6),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "statement_imports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "financial_account_id" UUID NOT NULL,
    "format" "StatementImportFormat" NOT NULL,
    "status" "StatementImportStatus" NOT NULL,
    "file_name" VARCHAR(200) NOT NULL,
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "imported_count" INTEGER NOT NULL DEFAULT 0,
    "duplicate_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "rows" JSONB NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "statement_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "financial_account_id" UUID NOT NULL,
    "statement_import_id" UUID,
    "transaction_date" DATE NOT NULL,
    "description" VARCHAR(240) NOT NULL,
    "reference" VARCHAR(120),
    "direction" "BankTransactionDirection" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "disposition" "BankTransactionDisposition" NOT NULL DEFAULT 'UNRESOLVED',
    "exclude_reason" VARCHAR(240),
    "suggested_account_id" UUID,
    "suggested_contact_id" UUID,
    "suggested_vendor_id" UUID,
    "suggested_tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "applied_from_rule_id" UUID,
    "posted_journal_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_transaction_matches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "bank_transaction_id" UUID NOT NULL,
    "target_type" "MatchTargetType" NOT NULL,
    "target_id" UUID NOT NULL,
    "note" VARCHAR(240),
    "matched_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_transaction_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "priority" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "match_any" BOOLEAN NOT NULL DEFAULT false,
    "conditions" JSONB NOT NULL,
    "suggest_account_id" UUID,
    "suggest_contact_id" UUID,
    "suggest_vendor_id" UUID,
    "suggest_tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "stop_on_match" BOOLEAN NOT NULL DEFAULT false,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "financial_account_id" UUID NOT NULL,
    "statement_start_date" DATE NOT NULL,
    "statement_end_date" DATE NOT NULL,
    "opening_balance_minor" BIGINT NOT NULL,
    "closing_balance_minor" BIGINT NOT NULL,
    "status" "ReconciliationStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "completed_at" TIMESTAMPTZ(6),
    "completed_by_user_id" UUID,
    "reopened_at" TIMESTAMPTZ(6),
    "reopened_by_user_id" UUID,
    "reopen_reason" VARCHAR(240),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_cleared_transactions" (
    "reconciliation_id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "marked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_cleared_transactions_pkey" PRIMARY KEY ("reconciliation_id","transaction_id")
);

-- CreateTable
CREATE TABLE "transfers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "transfer_number" VARCHAR(64),
    "status" "TransferStatus" NOT NULL DEFAULT 'POSTED',
    "transfer_date" DATE NOT NULL,
    "description" VARCHAR(240),
    "from_financial_account_id" UUID NOT NULL,
    "to_financial_account_id" UUID NOT NULL,
    "from_currency" CHAR(3) NOT NULL,
    "to_currency" CHAR(3) NOT NULL,
    "from_amount_minor" BIGINT NOT NULL,
    "to_amount_minor" BIGINT NOT NULL,
    "exchange_rate" DECIMAL(20,10),
    "journal_id" UUID NOT NULL,
    "voided_at" TIMESTAMPTZ(6),
    "void_journal_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transfers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "financial_accounts_organization_id_active_idx" ON "financial_accounts"("organization_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "financial_accounts_organization_id_name_key" ON "financial_accounts"("organization_id", "name");

-- CreateIndex
CREATE INDEX "statement_imports_organization_id_financial_account_id_crea_idx" ON "statement_imports"("organization_id", "financial_account_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transactions_posted_journal_id_key" ON "bank_transactions"("posted_journal_id");

-- CreateIndex
CREATE INDEX "bank_transactions_organization_id_financial_account_id_disp_idx" ON "bank_transactions"("organization_id", "financial_account_id", "disposition");

-- CreateIndex
CREATE INDEX "bank_transactions_organization_id_financial_account_id_tran_idx" ON "bank_transactions"("organization_id", "financial_account_id", "transaction_date");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transactions_financial_account_id_fingerprint_key" ON "bank_transactions"("financial_account_id", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transaction_matches_bank_transaction_id_key" ON "bank_transaction_matches"("bank_transaction_id");

-- CreateIndex
CREATE INDEX "bank_transaction_matches_organization_id_target_type_target_idx" ON "bank_transaction_matches"("organization_id", "target_type", "target_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transaction_matches_target_type_target_id_key" ON "bank_transaction_matches"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "bank_rules_organization_id_active_priority_idx" ON "bank_rules"("organization_id", "active", "priority");

-- CreateIndex
CREATE INDEX "reconciliations_organization_id_financial_account_id_status_idx" ON "reconciliations"("organization_id", "financial_account_id", "status");

-- CreateIndex
CREATE INDEX "reconciliation_cleared_transactions_transaction_id_idx" ON "reconciliation_cleared_transactions"("transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "transfers_journal_id_key" ON "transfers"("journal_id");

-- CreateIndex
CREATE UNIQUE INDEX "transfers_void_journal_id_key" ON "transfers"("void_journal_id");

-- CreateIndex
CREATE INDEX "transfers_organization_id_transfer_date_idx" ON "transfers"("organization_id", "transfer_date");

-- CreateIndex
CREATE UNIQUE INDEX "transfers_organization_id_transfer_number_key" ON "transfers"("organization_id", "transfer_number");

-- AddForeignKey
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_gl_account_id_fkey" FOREIGN KEY ("gl_account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statement_imports" ADD CONSTRAINT "statement_imports_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statement_imports" ADD CONSTRAINT "statement_imports_financial_account_id_fkey" FOREIGN KEY ("financial_account_id") REFERENCES "financial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statement_imports" ADD CONSTRAINT "statement_imports_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_financial_account_id_fkey" FOREIGN KEY ("financial_account_id") REFERENCES "financial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_statement_import_id_fkey" FOREIGN KEY ("statement_import_id") REFERENCES "statement_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_suggested_account_id_fkey" FOREIGN KEY ("suggested_account_id") REFERENCES "ledger_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_posted_journal_id_fkey" FOREIGN KEY ("posted_journal_id") REFERENCES "journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transaction_matches" ADD CONSTRAINT "bank_transaction_matches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transaction_matches" ADD CONSTRAINT "bank_transaction_matches_bank_transaction_id_fkey" FOREIGN KEY ("bank_transaction_id") REFERENCES "bank_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transaction_matches" ADD CONSTRAINT "bank_transaction_matches_matched_by_user_id_fkey" FOREIGN KEY ("matched_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_rules" ADD CONSTRAINT "bank_rules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_rules" ADD CONSTRAINT "bank_rules_suggest_account_id_fkey" FOREIGN KEY ("suggest_account_id") REFERENCES "ledger_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_rules" ADD CONSTRAINT "bank_rules_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_financial_account_id_fkey" FOREIGN KEY ("financial_account_id") REFERENCES "financial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_completed_by_user_id_fkey" FOREIGN KEY ("completed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_reopened_by_user_id_fkey" FOREIGN KEY ("reopened_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_cleared_transactions" ADD CONSTRAINT "reconciliation_cleared_transactions_reconciliation_id_fkey" FOREIGN KEY ("reconciliation_id") REFERENCES "reconciliations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_cleared_transactions" ADD CONSTRAINT "reconciliation_cleared_transactions_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "bank_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_from_financial_account_id_fkey" FOREIGN KEY ("from_financial_account_id") REFERENCES "financial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_to_financial_account_id_fkey" FOREIGN KEY ("to_financial_account_id") REFERENCES "financial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_void_journal_id_fkey" FOREIGN KEY ("void_journal_id") REFERENCES "journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

