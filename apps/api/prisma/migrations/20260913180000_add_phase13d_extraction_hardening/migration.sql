-- Phase 13D hardening: duplicate detection, field-level source provenance, and a permission-
-- filtered PostgreSQL keyword-search index over bounded OCR text (kept as extracted, not the raw
-- attachment). No pgvector/embeddings here -- keyword retrieval is the required first fallback,
-- and pgvector stays gated on its own verified Postgres image/migration/backup path.

ALTER TABLE "document_extractions"
  ADD COLUMN "source_regions" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "duplicate_of_attachment_id" UUID,
  ADD COLUMN "ocr_text" TEXT;

ALTER TABLE "document_extractions"
  ADD COLUMN "search_tsv" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce("ocr_text", ''))) STORED;

CREATE INDEX "document_extractions_search_tsv_idx" ON "document_extractions" USING GIN ("search_tsv");
