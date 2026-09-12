/**
 * Frozen render payload for issued-document PDFs (GAPS #38).
 *
 * Every value a PDF template renders (organization name, customer name, number, dates, currency,
 * totals, and per-line display data) is captured here ONCE inside the issue/approval transaction and
 * written to the document row's `pdfSnapshot` JSONB column. The send/portal paths render the PDF
 * from this payload -- never from the live `organization`/`contact` rows -- so renaming a customer or
 * restyling an organization after a document was issued can never restate what the issued document
 * declared. `schemaVersion` lets a future shape change read old payloads without guessing, mirroring
 * `StructuredInvoice.payloadSchemaVersion`.
 */

export const PDF_RENDER_SNAPSHOT_SCHEMA_VERSION = 1;

export type PdfRenderSnapshotLine = {
  descriptionSnapshot: string;
  quantity: string;
  unitPriceMinor: string;
  discountMinor: string;
  lineTotalMinor: string;
};

export type PdfRenderSnapshot = {
  schemaVersion: 1;
  organizationName: string;
  contactName: string;
  number: string | null;
  issueDate: string | null;
  currency: string;
  subtotalMinor: string;
  taxTotalMinor?: string;
  totalMinor: string;
  lines: readonly PdfRenderSnapshotLine[];
};

export type PdfRenderSnapshotInput = {
  organizationName: string;
  contactName: string;
  number: string | null;
  issueDate: string | null;
  currency: string;
  subtotalMinor: string;
  taxTotalMinor?: string | null;
  totalMinor: string;
  lines: readonly {
    descriptionSnapshot: string;
    quantity: { toString(): string };
    unitPriceMinor: { toString(): string };
    discountMinor: { toString(): string };
    lineTotalMinor: { toString(): string };
  }[];
};

export function buildPdfRenderSnapshot(input: PdfRenderSnapshotInput): PdfRenderSnapshot {
  return {
    schemaVersion: PDF_RENDER_SNAPSHOT_SCHEMA_VERSION,
    organizationName: input.organizationName,
    contactName: input.contactName,
    number: input.number,
    issueDate: input.issueDate,
    currency: input.currency,
    subtotalMinor: input.subtotalMinor,
    ...(input.taxTotalMinor === undefined || input.taxTotalMinor === null
      ? {}
      : { taxTotalMinor: input.taxTotalMinor }),
    totalMinor: input.totalMinor,
    lines: input.lines.map((line) => ({
      descriptionSnapshot: line.descriptionSnapshot,
      quantity: line.quantity.toString(),
      unitPriceMinor: line.unitPriceMinor.toString(),
      discountMinor: line.discountMinor.toString(),
      lineTotalMinor: line.lineTotalMinor.toString(),
    })),
  };
}

/**
 * Reads a stored `pdfSnapshot` column defensively. Returns `null` for legacy rows (written before
 * this payload existed) and for anything that does not carry the version this code understands; the
 * caller then falls back to building the PDF from the live record, preserving the pre-snapshot
 * behavior for old data.
 */
export function parsePdfRenderSnapshot(value: unknown): PdfRenderSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<PdfRenderSnapshot>;
  if (candidate.schemaVersion !== PDF_RENDER_SNAPSHOT_SCHEMA_VERSION) return null;
  if (typeof candidate.organizationName !== 'string') return null;
  if (typeof candidate.contactName !== 'string') return null;
  if (typeof candidate.currency !== 'string') return null;
  if (typeof candidate.subtotalMinor !== 'string' || typeof candidate.totalMinor !== 'string') {
    return null;
  }
  if (!Array.isArray(candidate.lines)) return null;
  return value as PdfRenderSnapshot;
}
