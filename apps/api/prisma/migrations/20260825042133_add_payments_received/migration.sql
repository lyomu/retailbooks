-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('UNAPPLIED', 'PARTIALLY_ALLOCATED', 'FULLY_ALLOCATED');

-- CreateTable
CREATE TABLE "payments_received" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "payment_number" VARCHAR(64),
    "status" "PaymentStatus" NOT NULL DEFAULT 'UNAPPLIED',
    "received_date" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "allocated_minor" BIGINT NOT NULL DEFAULT 0,
    "unapplied_minor" BIGINT NOT NULL,
    "deposit_account_id" UUID,
    "journal_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_received_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_received_journal_id_key" ON "payments_received"("journal_id");

-- CreateIndex
CREATE INDEX "payments_received_organization_id_status_received_date_idx" ON "payments_received"("organization_id", "status", "received_date");

-- CreateIndex
CREATE INDEX "payments_received_organization_id_contact_id_idx" ON "payments_received"("organization_id", "contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_received_organization_id_payment_number_key" ON "payments_received"("organization_id", "payment_number");

-- CreateIndex
CREATE INDEX "payment_allocations_organization_id_payment_id_idx" ON "payment_allocations"("organization_id", "payment_id");

-- CreateIndex
CREATE INDEX "payment_allocations_organization_id_invoice_id_idx" ON "payment_allocations"("organization_id", "invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_allocations_payment_id_invoice_id_key" ON "payment_allocations"("payment_id", "invoice_id");

-- AddForeignKey
ALTER TABLE "payments_received" ADD CONSTRAINT "payments_received_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments_received" ADD CONSTRAINT "payments_received_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments_received" ADD CONSTRAINT "payments_received_deposit_account_id_fkey" FOREIGN KEY ("deposit_account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments_received" ADD CONSTRAINT "payments_received_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments_received" ADD CONSTRAINT "payments_received_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments_received"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
