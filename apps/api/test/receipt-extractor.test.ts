import { describe, expect, it } from 'vitest';

import {
  extractReceiptCandidate,
  type KnownCategory,
  type KnownVendor,
  type ReceiptLine,
} from '../src/documents/receipt-extractor';

const BBOX = { x0: 0, y0: 0, x1: 10, y1: 10 };

function lines(...texts: string[]): ReceiptLine[] {
  return texts.map((text, index) => ({ text, page: 1, bbox: { ...BBOX, y0: index * 10 } }));
}

const VENDORS: KnownVendor[] = [{ id: 'vendor-1', displayName: 'Java House Ltd' }];
const CATEGORIES: KnownCategory[] = [{ id: 'category-1', name: 'Meals & Entertainment' }];

describe('extractReceiptCandidate', () => {
  it('extracts a clean receipt with matching arithmetic, vendor, and category', () => {
    const candidate = extractReceiptCandidate(
      lines(
        'Java House Ltd',
        '2024-03-15',
        'Meals & Entertainment',
        'Subtotal 1000.00',
        'Tax (VAT) 160.00',
        'Total KES 1160.00',
      ),
      VENDORS,
      CATEGORIES,
    );

    expect(candidate.vendorId).toBe('vendor-1');
    expect(candidate.vendorName).toBe('Java House Ltd');
    expect(candidate.date).toBe('2024-03-15');
    expect(candidate.currency).toBe('KES');
    expect(candidate.subtotalMinor).toBe(100000n);
    expect(candidate.taxMinor).toBe(16000n);
    expect(candidate.totalMinor).toBe(116000n);
    expect(candidate.arithmeticValid).toBe(true);
    expect(candidate.categoryId).toBe('category-1');
    expect(candidate.fieldFlags).not.toContain('arithmetic_mismatch');
    expect(candidate.sourceRegions.total?.text).toBe('Total KES 1160.00');
  });

  it('flags an arithmetic mismatch without discarding the parsed amounts', () => {
    const candidate = extractReceiptCandidate(
      lines('Unknown Vendor', 'Subtotal 1000.00', 'Tax 160.00', 'Total 2000.00'),
      [],
      [],
    );

    expect(candidate.subtotalMinor).toBe(100000n);
    expect(candidate.taxMinor).toBe(16000n);
    expect(candidate.totalMinor).toBe(200000n);
    expect(candidate.arithmeticValid).toBe(false);
    expect(candidate.fieldFlags).toContain('arithmetic_mismatch');
  });

  it('flags arithmetic as unverifiable, never invents a value, when a field is missing', () => {
    const candidate = extractReceiptCandidate(lines('Unknown Vendor', 'Total 500.00'), [], []);

    expect(candidate.totalMinor).toBe(50000n);
    expect(candidate.subtotalMinor).toBeNull();
    expect(candidate.taxMinor).toBeNull();
    expect(candidate.arithmeticValid).toBe(false);
    expect(candidate.fieldFlags).toContain('arithmetic_unverifiable');
    expect(candidate.fieldFlags).toContain('subtotal_unresolved');
    expect(candidate.fieldFlags).toContain('tax_unresolved');
  });

  it('does not let "subtotal" satisfy the "total" keyword match', () => {
    const candidate = extractReceiptCandidate(lines('Unknown Vendor', 'Subtotal 900.00'), [], []);

    expect(candidate.totalMinor).toBeNull();
    expect(candidate.subtotalMinor).toBe(90000n);
    expect(candidate.fieldFlags).toContain('total_unresolved');
  });

  it('parses an unambiguous DD/MM/YYYY date only when one component cannot be a month', () => {
    const candidate = extractReceiptCandidate(lines('Unknown Vendor', '25/03/2024'), [], []);
    expect(candidate.date).toBe('2024-03-25');
  });

  it('leaves an ambiguous D/M/Y date null rather than guessing the order', () => {
    const candidate = extractReceiptCandidate(lines('Unknown Vendor', '03/04/2024'), [], []);
    expect(candidate.date).toBeNull();
    expect(candidate.fieldFlags).toContain('date_ambiguous');
  });

  it('flags an unresolved date when no date-shaped text is present', () => {
    const candidate = extractReceiptCandidate(lines('Unknown Vendor', 'no date here'), [], []);
    expect(candidate.date).toBeNull();
    expect(candidate.fieldFlags).toContain('date_unresolved');
  });

  it('resolves currency from a known code, a symbol, and the "ksh" abbreviation', () => {
    expect(extractReceiptCandidate(lines('Vendor', 'Total USD 10.00'), [], []).currency).toBe(
      'USD',
    );
    expect(extractReceiptCandidate(lines('Vendor', 'Total $10.00'), [], []).currency).toBe('USD');
    expect(extractReceiptCandidate(lines('Vendor', 'Total Ksh 10.00'), [], []).currency).toBe(
      'KES',
    );
  });

  it('flags currency as unresolved rather than guessing one', () => {
    const candidate = extractReceiptCandidate(lines('Vendor', 'Total 10.00'), [], []);
    expect(candidate.currency).toBeNull();
    expect(candidate.fieldFlags).toContain('currency_unresolved');
  });

  it('matches a known vendor by near-equal normalized name', () => {
    const candidate = extractReceiptCandidate(lines('JAVA HOUSE LTD', 'Total 10.00'), VENDORS, []);
    expect(candidate.vendorId).toBe('vendor-1');
    expect(candidate.fieldFlags).not.toContain('vendor_unmatched');
  });

  it('keeps the raw vendor text but leaves vendorId null when no known vendor matches', () => {
    const candidate = extractReceiptCandidate(
      lines('Totally Different Shop', 'Total 10.00'),
      VENDORS,
      [],
    );
    expect(candidate.vendorId).toBeNull();
    expect(candidate.vendorName).toBe('Totally Different Shop');
    expect(candidate.fieldFlags).toContain('vendor_unmatched');
  });

  it('flags category as unmatched rather than picking an unrelated one', () => {
    const candidate = extractReceiptCandidate(lines('Vendor', 'Total 10.00'), [], CATEGORIES);
    expect(candidate.categoryId).toBeNull();
    expect(candidate.fieldFlags).toContain('category_unmatched');
  });

  it('ignores blank lines entirely', () => {
    const candidate = extractReceiptCandidate(
      [
        { text: '   ', page: 1, bbox: BBOX },
        { text: 'Vendor', page: 1, bbox: BBOX },
        { text: '', page: 1, bbox: BBOX },
        { text: 'Total 10.00', page: 1, bbox: BBOX },
      ],
      [],
      [],
    );
    expect(candidate.vendorName).toBe('Vendor');
    expect(candidate.totalMinor).toBe(1000n);
  });
});
