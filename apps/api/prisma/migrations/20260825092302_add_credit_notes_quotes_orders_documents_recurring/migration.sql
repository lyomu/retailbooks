-- CreateEnum
CREATE TYPE "CreditNoteStatus" AS ENUM ('DRAFT', 'ISSUED', 'APPLIED', 'REFUNDED', 'VOID');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "SalesOrderStatus" AS ENUM ('DRAFT', 'APPROVED', 'CONFIRMED', 'PARTIALLY_FULFILLED', 'FULFILLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RecurringCadence" AS ENUM ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUALLY');

-- CreateTable
CREATE TABLE "credit_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "credit_note_number" VARCHAR(64),
    "status" "CreditNoteStatus" NOT NULL DEFAULT 'DRAFT',
    "issue_date" DATE,
    "currency" CHAR(3) NOT NULL,
    "subtotal_minor" BIGINT NOT NULL DEFAULT 0,
    "tax_total_minor" BIGINT NOT NULL DEFAULT 0,
    "total_minor" BIGINT NOT NULL DEFAULT 0,
    "applied_minor" BIGINT NOT NULL DEFAULT 0,
    "refunded_minor" BIGINT NOT NULL DEFAULT 0,
    "remaining_minor" BIGINT NOT NULL DEFAULT 0,
    "journal_id" UUID,
    "voided_at" TIMESTAMPTZ(6),
    "sent_at" TIMESTAMPTZ(6),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_note_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "credit_note_id" UUID NOT NULL,
    "line_number" SMALLINT NOT NULL,
    "item_id" UUID,
    "description_snapshot" VARCHAR(240) NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit_price_minor" BIGINT NOT NULL,
    "discount_minor" BIGINT NOT NULL DEFAULT 0,
    "line_total_minor" BIGINT NOT NULL,
    "tax_code_id" UUID,
    "tax_code_snapshot" VARCHAR(24),
    "tax_treatment_snapshot" "TaxTreatment",
    "tax_recoverable_snapshot" BOOLEAN,
    "tax_rate_percent_snapshot" DECIMAL(7,4),
    "taxable_amount_minor" BIGINT,
    "tax_amount_minor" BIGINT,
    "revenue_account_id" UUID,
    "project_tag" VARCHAR(80),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_note_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_note_allocations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "credit_note_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "journal_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_note_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_note_refunds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "credit_note_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "journal_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_note_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "quote_number" VARCHAR(64),
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "issue_date" DATE,
    "expiry_date" DATE,
    "currency" CHAR(3) NOT NULL,
    "subtotal_minor" BIGINT NOT NULL DEFAULT 0,
    "total_minor" BIGINT NOT NULL DEFAULT 0,
    "converted_invoice_id" UUID,
    "sent_at" TIMESTAMPTZ(6),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "quote_id" UUID NOT NULL,
    "line_number" SMALLINT NOT NULL,
    "item_id" UUID,
    "description_snapshot" VARCHAR(240) NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit_price_minor" BIGINT NOT NULL,
    "discount_minor" BIGINT NOT NULL DEFAULT 0,
    "line_total_minor" BIGINT NOT NULL,
    "tax_code_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "order_number" VARCHAR(64),
    "status" "SalesOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "issue_date" DATE,
    "currency" CHAR(3) NOT NULL,
    "subtotal_minor" BIGINT NOT NULL DEFAULT 0,
    "total_minor" BIGINT NOT NULL DEFAULT 0,
    "converted_invoice_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_order_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "sales_order_id" UUID NOT NULL,
    "line_number" SMALLINT NOT NULL,
    "item_id" UUID,
    "description_snapshot" VARCHAR(240) NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit_price_minor" BIGINT NOT NULL,
    "discount_minor" BIGINT NOT NULL DEFAULT 0,
    "line_total_minor" BIGINT NOT NULL,
    "tax_code_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "document_type" VARCHAR(40) NOT NULL,
    "document_id" UUID NOT NULL,
    "storage_key" VARCHAR(500) NOT NULL,
    "rendered_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_invoice_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "cadence" "RecurringCadence" NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "next_run_date" DATE NOT NULL,
    "auto_create" BOOLEAN NOT NULL DEFAULT true,
    "auto_send" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "currency" CHAR(3) NOT NULL,
    "last_run_occurrence_key" VARCHAR(100),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recurring_invoice_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_invoice_template_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "line_number" SMALLINT NOT NULL,
    "item_id" UUID,
    "description_snapshot" VARCHAR(240) NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit_price_minor" BIGINT NOT NULL,
    "discount_minor" BIGINT NOT NULL DEFAULT 0,
    "line_total_minor" BIGINT NOT NULL,
    "tax_code_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recurring_invoice_template_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "credit_notes_journal_id_key" ON "credit_notes"("journal_id");

-- CreateIndex
CREATE INDEX "credit_notes_organization_id_status_issue_date_idx" ON "credit_notes"("organization_id", "status", "issue_date");

-- CreateIndex
CREATE INDEX "credit_notes_organization_id_contact_id_idx" ON "credit_notes"("organization_id", "contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_notes_organization_id_credit_note_number_key" ON "credit_notes"("organization_id", "credit_note_number");

-- CreateIndex
CREATE INDEX "credit_note_lines_organization_id_credit_note_id_idx" ON "credit_note_lines"("organization_id", "credit_note_id");

-- CreateIndex
CREATE INDEX "credit_note_lines_tax_code_id_idx" ON "credit_note_lines"("tax_code_id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_note_lines_credit_note_id_line_number_key" ON "credit_note_lines"("credit_note_id", "line_number");

-- CreateIndex
CREATE UNIQUE INDEX "credit_note_allocations_journal_id_key" ON "credit_note_allocations"("journal_id");

-- CreateIndex
CREATE INDEX "credit_note_allocations_organization_id_credit_note_id_idx" ON "credit_note_allocations"("organization_id", "credit_note_id");

-- CreateIndex
CREATE INDEX "credit_note_allocations_organization_id_invoice_id_idx" ON "credit_note_allocations"("organization_id", "invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_note_refunds_journal_id_key" ON "credit_note_refunds"("journal_id");

-- CreateIndex
CREATE INDEX "credit_note_refunds_organization_id_credit_note_id_idx" ON "credit_note_refunds"("organization_id", "credit_note_id");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_converted_invoice_id_key" ON "quotes"("converted_invoice_id");

-- CreateIndex
CREATE INDEX "quotes_organization_id_status_issue_date_idx" ON "quotes"("organization_id", "status", "issue_date");

-- CreateIndex
CREATE INDEX "quotes_organization_id_contact_id_idx" ON "quotes"("organization_id", "contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_organization_id_quote_number_key" ON "quotes"("organization_id", "quote_number");

-- CreateIndex
CREATE INDEX "quote_lines_organization_id_quote_id_idx" ON "quote_lines"("organization_id", "quote_id");

-- CreateIndex
CREATE UNIQUE INDEX "quote_lines_quote_id_line_number_key" ON "quote_lines"("quote_id", "line_number");

-- CreateIndex
CREATE UNIQUE INDEX "sales_orders_converted_invoice_id_key" ON "sales_orders"("converted_invoice_id");

-- CreateIndex
CREATE INDEX "sales_orders_organization_id_status_issue_date_idx" ON "sales_orders"("organization_id", "status", "issue_date");

-- CreateIndex
CREATE INDEX "sales_orders_organization_id_contact_id_idx" ON "sales_orders"("organization_id", "contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_orders_organization_id_order_number_key" ON "sales_orders"("organization_id", "order_number");

-- CreateIndex
CREATE INDEX "sales_order_lines_organization_id_sales_order_id_idx" ON "sales_order_lines"("organization_id", "sales_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_order_lines_sales_order_id_line_number_key" ON "sales_order_lines"("sales_order_id", "line_number");

-- CreateIndex
CREATE INDEX "document_snapshots_organization_id_document_type_idx" ON "document_snapshots"("organization_id", "document_type");

-- CreateIndex
CREATE UNIQUE INDEX "document_snapshots_organization_id_document_type_document_i_key" ON "document_snapshots"("organization_id", "document_type", "document_id");

-- CreateIndex
CREATE INDEX "recurring_invoice_templates_organization_id_active_next_run_idx" ON "recurring_invoice_templates"("organization_id", "active", "next_run_date");

-- CreateIndex
CREATE INDEX "recurring_invoice_templates_organization_id_contact_id_idx" ON "recurring_invoice_templates"("organization_id", "contact_id");

-- CreateIndex
CREATE INDEX "recurring_invoice_template_lines_organization_id_template_i_idx" ON "recurring_invoice_template_lines"("organization_id", "template_id");

-- CreateIndex
CREATE UNIQUE INDEX "recurring_invoice_template_lines_template_id_line_number_key" ON "recurring_invoice_template_lines"("template_id", "line_number");

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_credit_note_id_fkey" FOREIGN KEY ("credit_note_id") REFERENCES "credit_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_tax_code_id_fkey" FOREIGN KEY ("tax_code_id") REFERENCES "tax_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_revenue_account_id_fkey" FOREIGN KEY ("revenue_account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_allocations" ADD CONSTRAINT "credit_note_allocations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_allocations" ADD CONSTRAINT "credit_note_allocations_credit_note_id_fkey" FOREIGN KEY ("credit_note_id") REFERENCES "credit_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_allocations" ADD CONSTRAINT "credit_note_allocations_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_allocations" ADD CONSTRAINT "credit_note_allocations_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_refunds" ADD CONSTRAINT "credit_note_refunds_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_refunds" ADD CONSTRAINT "credit_note_refunds_credit_note_id_fkey" FOREIGN KEY ("credit_note_id") REFERENCES "credit_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_refunds" ADD CONSTRAINT "credit_note_refunds_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_refunds" ADD CONSTRAINT "credit_note_refunds_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_converted_invoice_id_fkey" FOREIGN KEY ("converted_invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_tax_code_id_fkey" FOREIGN KEY ("tax_code_id") REFERENCES "tax_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_converted_invoice_id_fkey" FOREIGN KEY ("converted_invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_tax_code_id_fkey" FOREIGN KEY ("tax_code_id") REFERENCES "tax_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_snapshots" ADD CONSTRAINT "document_snapshots_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_invoice_templates" ADD CONSTRAINT "recurring_invoice_templates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_invoice_templates" ADD CONSTRAINT "recurring_invoice_templates_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_invoice_templates" ADD CONSTRAINT "recurring_invoice_templates_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_invoice_template_lines" ADD CONSTRAINT "recurring_invoice_template_lines_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_invoice_template_lines" ADD CONSTRAINT "recurring_invoice_template_lines_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "recurring_invoice_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_invoice_template_lines" ADD CONSTRAINT "recurring_invoice_template_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_invoice_template_lines" ADD CONSTRAINT "recurring_invoice_template_lines_tax_code_id_fkey" FOREIGN KEY ("tax_code_id") REFERENCES "tax_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
