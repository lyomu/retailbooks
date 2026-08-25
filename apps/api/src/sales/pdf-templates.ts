interface PdfLine {
  descriptionSnapshot: string;
  quantity: string;
  unitPriceMinor: string;
  discountMinor: string;
  lineTotalMinor: string;
}

interface PdfDocument {
  documentLabel: string;
  number: string | null;
  organizationName: string;
  contactName: string;
  issueDate: string | null;
  currency: string;
  lines: readonly PdfLine[];
  subtotalMinor: string;
  taxTotalMinor?: string;
  totalMinor: string;
}

function formatMinor(value: string, currency: string): string {
  const amount = BigInt(value);
  const whole = amount / 100n;
  const cents = amount % 100n;
  return `${currency} ${whole.toString()}.${cents.toString().padStart(2, '0')}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderDocumentHtml(doc: PdfDocument): string {
  const rows = doc.lines
    .map(
      (line) => `
        <tr>
          <td>${escapeHtml(line.descriptionSnapshot)}</td>
          <td class="num">${escapeHtml(line.quantity)}</td>
          <td class="num">${formatMinor(line.unitPriceMinor, doc.currency)}</td>
          <td class="num">${formatMinor(line.discountMinor, doc.currency)}</td>
          <td class="num">${formatMinor(line.lineTotalMinor, doc.currency)}</td>
        </tr>`,
    )
    .join('');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  body { font-family: Arial, sans-serif; color: #1a1a1a; margin: 32px; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  .meta { color: #555; margin-bottom: 24px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  th, td { padding: 6px 8px; border-bottom: 1px solid #ddd; text-align: left; font-size: 12px; }
  th { background: #f4f4f4; }
  .num { text-align: right; }
  .totals { width: 260px; margin-left: auto; }
  .totals td { border: none; padding: 2px 8px; }
  .totals .grand { font-weight: bold; border-top: 1px solid #333; }
</style>
</head>
<body>
  <h1>${escapeHtml(doc.organizationName)}</h1>
  <div class="meta">
    ${escapeHtml(doc.documentLabel)} ${doc.number ? escapeHtml(doc.number) : ''}<br />
    Bill to: ${escapeHtml(doc.contactName)}<br />
    ${doc.issueDate ? `Date: ${escapeHtml(doc.issueDate)}` : ''}
  </div>
  <table>
    <thead>
      <tr><th>Description</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Discount</th><th class="num">Total</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <table class="totals">
    <tbody>
      <tr><td>Subtotal</td><td class="num">${formatMinor(doc.subtotalMinor, doc.currency)}</td></tr>
      ${doc.taxTotalMinor !== undefined ? `<tr><td>Tax</td><td class="num">${formatMinor(doc.taxTotalMinor, doc.currency)}</td></tr>` : ''}
      <tr class="grand"><td>Total</td><td class="num">${formatMinor(doc.totalMinor, doc.currency)}</td></tr>
    </tbody>
  </table>
</body>
</html>`;
}

export function renderInvoiceHtml(
  organizationName: string,
  invoice: {
    invoiceNumber: string | null;
    contactName: string;
    issueDate: string | null;
    currency: string;
    subtotalMinor: string;
    taxTotalMinor: string;
    totalMinor: string;
    lines: readonly PdfLine[];
  },
): string {
  return renderDocumentHtml({
    documentLabel: 'Invoice',
    number: invoice.invoiceNumber,
    organizationName,
    contactName: invoice.contactName,
    issueDate: invoice.issueDate,
    currency: invoice.currency,
    lines: invoice.lines,
    subtotalMinor: invoice.subtotalMinor,
    taxTotalMinor: invoice.taxTotalMinor,
    totalMinor: invoice.totalMinor,
  });
}

export function renderCreditNoteHtml(
  organizationName: string,
  creditNote: {
    creditNoteNumber: string | null;
    contactName: string;
    issueDate: string | null;
    currency: string;
    subtotalMinor: string;
    taxTotalMinor: string;
    totalMinor: string;
    lines: readonly PdfLine[];
  },
): string {
  return renderDocumentHtml({
    documentLabel: 'Credit Note',
    number: creditNote.creditNoteNumber,
    organizationName,
    contactName: creditNote.contactName,
    issueDate: creditNote.issueDate,
    currency: creditNote.currency,
    lines: creditNote.lines,
    subtotalMinor: creditNote.subtotalMinor,
    taxTotalMinor: creditNote.taxTotalMinor,
    totalMinor: creditNote.totalMinor,
  });
}

export function renderQuoteHtml(
  organizationName: string,
  quote: {
    quoteNumber: string | null;
    contactName: string;
    issueDate: string | null;
    currency: string;
    subtotalMinor: string;
    totalMinor: string;
    lines: readonly PdfLine[];
  },
): string {
  return renderDocumentHtml({
    documentLabel: 'Quote',
    number: quote.quoteNumber,
    organizationName,
    contactName: quote.contactName,
    issueDate: quote.issueDate,
    currency: quote.currency,
    lines: quote.lines,
    subtotalMinor: quote.subtotalMinor,
    totalMinor: quote.totalMinor,
  });
}
