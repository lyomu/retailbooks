CREATE TYPE "TaxCodeStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

CREATE TABLE "tax_codes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "code" VARCHAR(24) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "treatment" "TaxTreatment" NOT NULL,
  "recoverable" BOOLEAN NOT NULL DEFAULT false,
  "status" "TaxCodeStatus" NOT NULL DEFAULT 'ACTIVE',
  "description" VARCHAR(240),
  "sales_tax_account_id" UUID,
  "purchase_tax_account_id" UUID,
  "system_seed" BOOLEAN NOT NULL DEFAULT false,
  "archived_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tax_codes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tax_codes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "tax_codes_sales_tax_account_id_fkey" FOREIGN KEY ("sales_tax_account_id") REFERENCES "ledger_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "tax_codes_purchase_tax_account_id_fkey" FOREIGN KEY ("purchase_tax_account_id") REFERENCES "ledger_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "tax_codes_organization_id_code_key" ON "tax_codes"("organization_id", "code");
CREATE INDEX "tax_codes_organization_id_status_idx" ON "tax_codes"("organization_id", "status");

CREATE TABLE "tax_rates" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "tax_code_id" UUID NOT NULL,
  "rate_percent" DECIMAL(7, 4) NOT NULL,
  "effective_from" DATE NOT NULL,
  "effective_to" DATE,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tax_rates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tax_rates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "tax_rates_tax_code_id_fkey" FOREIGN KEY ("tax_code_id") REFERENCES "tax_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "tax_rates_tax_code_id_effective_from_key" ON "tax_rates"("tax_code_id", "effective_from");
CREATE INDEX "tax_rates_organization_id_tax_code_id_effective_from_idx" ON "tax_rates"("organization_id", "tax_code_id", "effective_from");

ALTER TABLE "journal_lines"
  ADD COLUMN "tax_code_id" UUID,
  ADD COLUMN "tax_code_snapshot" VARCHAR(24),
  ADD COLUMN "tax_treatment_snapshot" "TaxTreatment",
  ADD COLUMN "tax_recoverable_snapshot" BOOLEAN,
  ADD COLUMN "tax_rate_percent_snapshot" DECIMAL(7, 4),
  ADD COLUMN "taxable_amount_minor" BIGINT,
  ADD COLUMN "tax_amount_minor" BIGINT;

ALTER TABLE "journal_lines"
  ADD CONSTRAINT "journal_lines_tax_code_id_fkey" FOREIGN KEY ("tax_code_id") REFERENCES "tax_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "journal_lines_tax_code_id_idx" ON "journal_lines"("tax_code_id");
