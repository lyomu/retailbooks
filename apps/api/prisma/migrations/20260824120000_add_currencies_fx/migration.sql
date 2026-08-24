-- CreateEnum
CREATE TYPE "CurrencyStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- AlterTable
ALTER TABLE "journal_lines" ADD COLUMN     "exchange_rate" DECIMAL(20,10),
ADD COLUMN     "foreign_amount_minor" BIGINT;

-- AlterTable
ALTER TABLE "journals" ADD COLUMN     "exchange_rate" DECIMAL(20,10);

-- CreateTable
CREATE TABLE "currencies" (
    "code" CHAR(3) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "symbol" VARCHAR(8) NOT NULL,
    "decimals" SMALLINT NOT NULL,
    "status" "CurrencyStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "currencies_pkey" PRIMARY KEY ("code"),
    CONSTRAINT "currencies_decimals_check" CHECK ("decimals" BETWEEN 0 AND 6)
);

-- CreateTable
CREATE TABLE "organization_currencies" (
    "organization_id" UUID NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "is_base" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_currencies_pkey" PRIMARY KEY ("organization_id","currency_code")
);

-- CreateTable
CREATE TABLE "exchange_rates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "base_currency" CHAR(3) NOT NULL,
    "quote_currency" CHAR(3) NOT NULL,
    "rate" DECIMAL(20,10) NOT NULL,
    "rate_date" DATE NOT NULL,
    "source" VARCHAR(40) NOT NULL DEFAULT 'MANUAL',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "exchange_rates_positive_rate_check" CHECK ("rate" > 0),
    CONSTRAINT "exchange_rates_distinct_pair_check" CHECK ("base_currency" <> "quote_currency")
);

-- Static ISO-style reference rows are inserted with the migration so foreign keys are valid before
-- the first application service starts. CurrencyService keeps this catalog forward-compatible.
INSERT INTO "currencies" ("code", "name", "symbol", "decimals") VALUES
('AED', 'UAE dirham', 'AED', 2),
('AUD', 'Australian dollar', 'A$', 2),
('CAD', 'Canadian dollar', 'C$', 2),
('EUR', 'Euro', '€', 2),
('GBP', 'Pound sterling', '£', 2),
('GHS', 'Ghanaian cedi', 'GH₵', 2),
('INR', 'Indian rupee', '₹', 2),
('KES', 'Kenyan shilling', 'KSh', 2),
('NGN', 'Nigerian naira', '₦', 2),
('NZD', 'New Zealand dollar', 'NZ$', 2),
('RWF', 'Rwandan franc', 'RF', 0),
('SGD', 'Singapore dollar', 'S$', 2),
('TZS', 'Tanzanian shilling', 'TSh', 2),
('UGX', 'Ugandan shilling', 'USh', 0),
('USD', 'United States dollar', '$', 2),
('ZAR', 'South African rand', 'R', 2);

INSERT INTO "organization_currencies" ("organization_id", "currency_code", "is_base", "enabled")
SELECT "id", "base_currency", true, true FROM "organizations";

-- CreateIndex
CREATE INDEX "currencies_status_idx" ON "currencies"("status");

-- CreateIndex
CREATE INDEX "organization_currencies_organization_id_enabled_idx" ON "organization_currencies"("organization_id", "enabled");

-- Prisma cannot express a partial unique index. This enforces exactly one marked base row at most;
-- Organization.base_currency remains the canonical protected setting.
CREATE UNIQUE INDEX "organization_currencies_one_base_per_org"
ON "organization_currencies" ("organization_id") WHERE "is_base" = true;

-- CreateIndex
CREATE INDEX "exchange_rates_organization_id_quote_currency_rate_date_idx" ON "exchange_rates"("organization_id", "quote_currency", "rate_date");

-- CreateIndex
CREATE UNIQUE INDEX "exchange_rates_organization_id_base_currency_quote_currency_key" ON "exchange_rates"("organization_id", "base_currency", "quote_currency", "rate_date");

-- AddForeignKey
ALTER TABLE "organization_currencies" ADD CONSTRAINT "organization_currencies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_currencies" ADD CONSTRAINT "organization_currencies_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_base_currency_fkey" FOREIGN KEY ("base_currency") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_quote_currency_fkey" FOREIGN KEY ("quote_currency") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "journal_lines"
ADD CONSTRAINT "journal_lines_positive_foreign_amount_check"
CHECK ("foreign_amount_minor" IS NULL OR "foreign_amount_minor" > 0);
