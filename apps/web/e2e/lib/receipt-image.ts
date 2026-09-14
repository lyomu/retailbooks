import { createCanvas } from '@napi-rs/canvas';

/** Renders a plain, high-contrast synthetic receipt as a real PNG -- legible to the actual
 * tesseract.js OCR the live pipeline runs, not hand-fed OCR text. Confirmed legible by direct
 * smoke test before use here (see the session notes around 2026-09-14's document-extraction
 * pipeline work): black text on white, one line per row, large sans-serif font. */
export function renderReceiptPng(lines: readonly string[]): Buffer {
  const width = 700;
  const lineHeight = 44;
  const height = lineHeight * (lines.length + 2);
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#000000';
  context.font = '32px sans-serif';
  context.textBaseline = 'top';
  lines.forEach((line, index) => {
    context.fillText(line, 20, lineHeight * (index + 1));
  });
  return canvas.toBuffer('image/png');
}
