-- Phase 13D: secure Expense-attachment scan/OCR/extraction foundation.
--
-- DocumentExtraction records only hashes, status, and small structured candidate fields. No raw
-- attachment bytes, OCR text, or signed URLs are stored here or in any audit event -- an accepted
-- candidate never creates or mutates an Expense on its own; the reviewer still uses the existing
-- Expense draft routes.

ALTER TABLE "attachments" ADD COLUMN "content_hash" CHAR(64);

CREATE TYPE "DocumentExtractionStatus" AS ENUM (
  'PENDING',
  'SCANNING',
  'QUARANTINED',
  'UNSUPPORTED_FOR_EXTRACTION',
  'OCR_PROCESSING',
  'EXTRACTING',
  'READY_FOR_REVIEW',
  'FAILED'
);

CREATE TYPE "DocumentExtractionDisposition" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

CREATE TABLE "document_extractions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "attachment_id" UUID NOT NULL,
  "entity_type" "AttachmentEntityType" NOT NULL,
  "entity_id" UUID NOT NULL,
  "status" "DocumentExtractionStatus" NOT NULL DEFAULT 'PENDING',
  "failure_reason" VARCHAR(80),
  "scan_engine_version" VARCHAR(80),
  "scan_signature" VARCHAR(200),
  "content_hash" CHAR(64) NOT NULL,
  "ocr_text_hash" CHAR(64),
  "candidate_vendor_name" VARCHAR(160),
  "candidate_vendor_id" UUID,
  "candidate_date" DATE,
  "candidate_currency" CHAR(3),
  "candidate_subtotal_minor" BIGINT,
  "candidate_tax_minor" BIGINT,
  "candidate_total_minor" BIGINT,
  "candidate_category_id" UUID,
  "arithmetic_valid" BOOLEAN NOT NULL DEFAULT false,
  "field_flags" JSONB NOT NULL DEFAULT '[]',
  "disposition" "DocumentExtractionDisposition" NOT NULL DEFAULT 'PENDING',
  "reviewed_at" TIMESTAMPTZ(6),
  "reviewed_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "document_extractions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "document_extractions_attachment_id_key" ON "document_extractions"("attachment_id");
CREATE INDEX "document_extractions_organization_id_entity_type_entity_id_idx"
  ON "document_extractions"("organization_id", "entity_type", "entity_id");
CREATE INDEX "document_extractions_organization_id_status_idx"
  ON "document_extractions"("organization_id", "status");

ALTER TABLE "document_extractions"
  ADD CONSTRAINT "document_extractions_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "document_extractions_attachment_id_fkey"
  FOREIGN KEY ("attachment_id") REFERENCES "attachments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
