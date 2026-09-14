/**
 * Hand-built, byte-offset-correct, single-page PDF (no PDF-generation library is a dependency of
 * this repo). Just enough PDF 1.4 to be a real, standards-valid document that `pdfjs-dist` (the
 * same rasterizer the production document-extraction pipeline uses) can parse and render: a
 * Catalog, one Page, a standard Helvetica font, and a content stream drawing one line of text per
 * string given, top to bottom. Offsets in the xref table are computed from the actual bytes
 * written, not hard-coded, so this stays correct if the header/object text ever changes.
 */
export function buildMinimalPdf(lines: readonly string[]): Buffer {
  const width = 500;
  const lineHeight = 30;
  const topMargin = 40;
  const height = topMargin + lineHeight * lines.length + 20;

  const contentOperators = lines
    .map((line, index) => {
      const y = height - topMargin - lineHeight * index;
      return `BT /F1 18 Tf 20 ${y} Td (${escapePdfString(line)}) Tj ET`;
    })
    .join('\n');
  const stream = `${contentOperators}\n`;
  const streamLength = Buffer.byteLength(stream, 'latin1');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 ${width} ${height}] /Contents 5 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${streamLength} >>\nstream\n${stream}endstream`,
  ];

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((content, index) => {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${index + 1} 0 obj\n${content}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(body, 'latin1');
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(body + xref + trailer, 'latin1');
}

function escapePdfString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
}
