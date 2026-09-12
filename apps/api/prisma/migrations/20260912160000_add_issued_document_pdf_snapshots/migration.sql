-- GAPS #38: issued documents render PDFs from immutable snapshots, so the frozen render payload
-- (organization/customer display names, number, dates, currency, totals, lines) is stored on the
-- issued document itself the moment it is issued/approved. The PDF read path uses this payload and
-- never the live organization/contact rows, so a later rename cannot restate the issued document.

-- AlterTable
ALTER TABLE "credit_notes" ADD COLUMN     "pdf_snapshot" JSONB;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "pdf_snapshot" JSONB;

-- AlterTable
ALTER TABLE "quotes" ADD COLUMN     "pdf_snapshot" JSONB;