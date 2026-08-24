-- CreateTable
CREATE TABLE "document_numbering_configs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "document_type" VARCHAR(40) NOT NULL,
    "prefix" VARCHAR(16) NOT NULL,
    "number_padding" SMALLINT NOT NULL,
    "next_number" INTEGER NOT NULL DEFAULT 1,
    "numbering_reset" "NumberingReset" NOT NULL DEFAULT 'ANNUAL',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_numbering_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_numbering_configs_organization_id_document_type_key" ON "document_numbering_configs"("organization_id", "document_type");

-- AddForeignKey
ALTER TABLE "document_numbering_configs" ADD CONSTRAINT "document_numbering_configs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
