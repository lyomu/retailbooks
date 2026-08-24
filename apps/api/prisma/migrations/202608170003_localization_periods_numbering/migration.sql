CREATE TYPE "FiscalPeriodStatus" AS ENUM ('OPEN', 'CLOSED', 'LOCKED');

CREATE TABLE "fiscal_years" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "label" VARCHAR(24) NOT NULL,
  "starts_on" DATE NOT NULL,
  "ends_on" DATE NOT NULL,
  "status" "FiscalPeriodStatus" NOT NULL DEFAULT 'OPEN',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fiscal_years_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fiscal_years_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "fiscal_years_organization_id_label_key" ON "fiscal_years"("organization_id", "label");
CREATE UNIQUE INDEX "fiscal_years_organization_id_starts_on_key" ON "fiscal_years"("organization_id", "starts_on");
CREATE INDEX "fiscal_years_organization_id_status_idx" ON "fiscal_years"("organization_id", "status");

CREATE TABLE "fiscal_periods" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "fiscal_year_id" UUID NOT NULL,
  "code" VARCHAR(32) NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "starts_on" DATE NOT NULL,
  "ends_on" DATE NOT NULL,
  "status" "FiscalPeriodStatus" NOT NULL DEFAULT 'OPEN',
  "closed_at" TIMESTAMPTZ(6),
  "locked_at" TIMESTAMPTZ(6),
  "reopened_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fiscal_periods_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fiscal_periods_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "fiscal_periods_fiscal_year_id_fkey" FOREIGN KEY ("fiscal_year_id") REFERENCES "fiscal_years"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "fiscal_periods_organization_id_code_key" ON "fiscal_periods"("organization_id", "code");
CREATE UNIQUE INDEX "fiscal_periods_organization_id_starts_on_key" ON "fiscal_periods"("organization_id", "starts_on");
CREATE INDEX "fiscal_periods_organization_id_status_idx" ON "fiscal_periods"("organization_id", "status");
CREATE INDEX "fiscal_periods_fiscal_year_id_starts_on_idx" ON "fiscal_periods"("fiscal_year_id", "starts_on");

CREATE TABLE "document_number_sequences" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "document_type" VARCHAR(40) NOT NULL,
  "scope_key" VARCHAR(32) NOT NULL,
  "prefix" VARCHAR(16) NOT NULL,
  "number_padding" SMALLINT NOT NULL,
  "numbering_reset" "NumberingReset" NOT NULL,
  "next_number" INTEGER NOT NULL,
  "last_allocated_number" INTEGER,
  "last_allocated_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "document_number_sequences_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "document_number_sequences_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "document_number_sequences_org_type_scope_key" ON "document_number_sequences"("organization_id", "document_type", "scope_key");
CREATE INDEX "document_number_sequences_organization_id_document_type_idx" ON "document_number_sequences"("organization_id", "document_type");
