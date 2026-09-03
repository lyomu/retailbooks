-- CreateEnum
CREATE TYPE "CountryPackStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'DEPRECATED');

-- CreateEnum
CREATE TYPE "CountryPackTier" AS ENUM ('TIER_A_REVIEWED', 'TIER_B_GENERIC', 'TIER_C_BLOCKED');

-- AlterTable
ALTER TABLE "bills" ADD COLUMN     "country_pack_code_snapshot" VARCHAR(8),
ADD COLUMN     "country_pack_version_snapshot" VARCHAR(24);

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "country_pack_code_snapshot" VARCHAR(8),
ADD COLUMN     "country_pack_version_snapshot" VARCHAR(24);

-- CreateTable
CREATE TABLE "country_packs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(8) NOT NULL,
    "version" VARCHAR(24) NOT NULL,
    "country_code" VARCHAR(2) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "status" "CountryPackStatus" NOT NULL DEFAULT 'DRAFT',
    "tier" "CountryPackTier" NOT NULL DEFAULT 'TIER_B_GENERIC',
    "defaults" JSONB NOT NULL,
    "notes" JSONB NOT NULL,
    "supportedEntityTypes" JSONB NOT NULL,
    "published_at" TIMESTAMPTZ(6),
    "deprecated_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "country_packs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_packs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "country_pack_id" UUID NOT NULL,
    "version" VARCHAR(24) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "rates" JSONB NOT NULL,
    "registration_fields" JSONB NOT NULL DEFAULT '[]',
    "exemptions" JSONB NOT NULL DEFAULT '[]',
    "reporting_mappings" JSONB NOT NULL DEFAULT '{}',
    "notes" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_packs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "country_pack_id" UUID NOT NULL,
    "document_type" VARCHAR(40) NOT NULL,
    "required_legal_fields" JSONB NOT NULL DEFAULT '[]',
    "numbering_constraints" JSONB NOT NULL DEFAULT '{}',
    "labels" JSONB NOT NULL DEFAULT '{}',
    "footer_text" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "structured_invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "document_type" VARCHAR(40) NOT NULL,
    "document_id" UUID NOT NULL,
    "country_pack_code" VARCHAR(8) NOT NULL,
    "country_pack_version" VARCHAR(24) NOT NULL,
    "payload_schema_version" VARCHAR(12) NOT NULL DEFAULT '1',
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "structured_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "country_packs_code_status_idx" ON "country_packs"("code", "status");

-- CreateIndex
CREATE UNIQUE INDEX "country_packs_code_version_key" ON "country_packs"("code", "version");

-- CreateIndex
CREATE INDEX "tax_packs_country_pack_id_idx" ON "tax_packs"("country_pack_id");

-- CreateIndex
CREATE UNIQUE INDEX "tax_packs_country_pack_id_version_key" ON "tax_packs"("country_pack_id", "version");

-- CreateIndex
CREATE INDEX "document_rules_country_pack_id_idx" ON "document_rules"("country_pack_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_rules_country_pack_id_document_type_key" ON "document_rules"("country_pack_id", "document_type");

-- CreateIndex
CREATE INDEX "structured_invoices_organization_id_document_type_idx" ON "structured_invoices"("organization_id", "document_type");

-- CreateIndex
CREATE UNIQUE INDEX "structured_invoices_organization_id_document_type_document__key" ON "structured_invoices"("organization_id", "document_type", "document_id");

-- AddForeignKey
ALTER TABLE "tax_packs" ADD CONSTRAINT "tax_packs_country_pack_id_fkey" FOREIGN KEY ("country_pack_id") REFERENCES "country_packs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_rules" ADD CONSTRAINT "document_rules_country_pack_id_fkey" FOREIGN KEY ("country_pack_id") REFERENCES "country_packs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "structured_invoices" ADD CONSTRAINT "structured_invoices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
