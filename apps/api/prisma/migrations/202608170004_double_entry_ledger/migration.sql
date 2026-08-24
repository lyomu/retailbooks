CREATE TYPE "LedgerAccountType" AS ENUM (
  'ASSET',
  'LIABILITY',
  'EQUITY',
  'REVENUE',
  'EXPENSE',
  'COST_OF_SALES',
  'OTHER_INCOME',
  'OTHER_EXPENSE'
);

CREATE TYPE "LedgerNormalBalance" AS ENUM ('DEBIT', 'CREDIT');
CREATE TYPE "LedgerAccountStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "JournalStatus" AS ENUM ('DRAFT', 'POSTED', 'REVERSED');

CREATE TABLE "ledger_accounts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "code" VARCHAR(24) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "type" "LedgerAccountType" NOT NULL,
  "normal_balance" "LedgerNormalBalance" NOT NULL,
  "status" "LedgerAccountStatus" NOT NULL DEFAULT 'ACTIVE',
  "description" VARCHAR(240),
  "system_seed" BOOLEAN NOT NULL DEFAULT false,
  "archived_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ledger_accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ledger_accounts_organization_id_code_key" ON "ledger_accounts"("organization_id", "code");
CREATE INDEX "ledger_accounts_organization_id_status_idx" ON "ledger_accounts"("organization_id", "status");
CREATE INDEX "ledger_accounts_organization_id_type_idx" ON "ledger_accounts"("organization_id", "type");

CREATE TABLE "journals" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "reference" VARCHAR(64),
  "status" "JournalStatus" NOT NULL DEFAULT 'DRAFT',
  "journal_date" DATE NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "description" VARCHAR(240) NOT NULL,
  "source_type" VARCHAR(60),
  "source_id" VARCHAR(100),
  "posted_at" TIMESTAMPTZ(6),
  "posted_by_user_id" UUID,
  "created_by_user_id" UUID NOT NULL,
  "reversal_of_journal_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "journals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "journals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "journals_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "journals_posted_by_user_id_fkey" FOREIGN KEY ("posted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "journals_reversal_of_journal_id_fkey" FOREIGN KEY ("reversal_of_journal_id") REFERENCES "journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "journals_organization_id_reference_key" ON "journals"("organization_id", "reference");
CREATE UNIQUE INDEX "journals_reversal_of_journal_id_key" ON "journals"("reversal_of_journal_id");
CREATE INDEX "journals_organization_id_status_journal_date_idx" ON "journals"("organization_id", "status", "journal_date");
CREATE INDEX "journals_organization_id_journal_date_idx" ON "journals"("organization_id", "journal_date");
CREATE INDEX "journals_reversal_of_journal_id_idx" ON "journals"("reversal_of_journal_id");

CREATE TABLE "journal_lines" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "journal_id" UUID NOT NULL,
  "account_id" UUID NOT NULL,
  "line_number" SMALLINT NOT NULL,
  "description" VARCHAR(240),
  "debit_minor" BIGINT NOT NULL DEFAULT 0,
  "credit_minor" BIGINT NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "journal_lines_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "journal_lines_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "journals"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "journal_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "journal_lines_journal_id_line_number_key" ON "journal_lines"("journal_id", "line_number");
CREATE INDEX "journal_lines_organization_id_account_id_idx" ON "journal_lines"("organization_id", "account_id");
CREATE INDEX "journal_lines_organization_id_journal_id_idx" ON "journal_lines"("organization_id", "journal_id");

CREATE TABLE "ledger_idempotency_keys" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "key" VARCHAR(120) NOT NULL,
  "operation" VARCHAR(40) NOT NULL,
  "resource_type" VARCHAR(40) NOT NULL,
  "resource_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ledger_idempotency_keys_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ledger_idempotency_keys_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ledger_idempotency_keys_organization_id_operation_key_key" ON "ledger_idempotency_keys"("organization_id", "operation", "key");
CREATE INDEX "ledger_idempotency_keys_organization_id_resource_type_resource_id_idx" ON "ledger_idempotency_keys"("organization_id", "resource_type", "resource_id");
