/**
 * Deterministic, regex/keyword-only receipt-field extraction. No model call anywhere in this file
 * -- OCR text is treated purely as data. Every field that can't be parsed with reasonable confidence
 * is left `null` and named in `fieldFlags`; nothing is guessed or defaulted, per the
 * "never invent a value or vendor" requirement. This is intentionally simple: a first deterministic
 * pass, not a general-purpose document-understanding engine.
 */

export interface ReceiptLine {
  readonly text: string;
  readonly page: number;
  readonly bbox: {
    readonly x0: number;
    readonly y0: number;
    readonly x1: number;
    readonly y1: number;
  };
}

export interface SourceRegion {
  readonly lineIndex: number;
  readonly page: number;
  readonly text: string;
  readonly bbox: ReceiptLine['bbox'];
}

export interface ReceiptCandidate {
  vendorName: string | null;
  vendorId: string | null;
  date: string | null;
  currency: string | null;
  subtotalMinor: bigint | null;
  taxMinor: bigint | null;
  totalMinor: bigint | null;
  categoryId: string | null;
  arithmeticValid: boolean;
  fieldFlags: string[];
  sourceRegions: Record<string, SourceRegion>;
}

export interface KnownVendor {
  id: string;
  displayName: string;
}

export interface KnownCategory {
  id: string;
  name: string;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  $: 'USD',
  '€': 'EUR',
  '£': 'GBP',
};

export function extractReceiptCandidate(
  lines: readonly ReceiptLine[],
  knownVendors: readonly KnownVendor[],
  knownCategories: readonly KnownCategory[],
): ReceiptCandidate {
  const nonEmptyLines = lines.filter((line) => line.text.trim().length > 0);
  const fullText = nonEmptyLines.map((line) => line.text).join('\n');
  const flags: string[] = [];
  const sourceRegions: Record<string, SourceRegion> = {};

  const currency = extractCurrency(fullText, flags);
  const date = extractDate(fullText, flags);

  const total = extractAmount(
    nonEmptyLines,
    ['total', 'amount due', 'grand total'],
    ['subtotal'],
    flags,
    'total',
  );
  const subtotal = extractAmount(
    nonEmptyLines,
    ['subtotal', 'sub-total', 'sub total'],
    [],
    flags,
    'subtotal',
  );
  const tax = extractAmount(nonEmptyLines, ['tax', 'vat', 'gst'], [], flags, 'tax');
  if (total) sourceRegions.total = total.region;
  if (subtotal) sourceRegions.subtotal = subtotal.region;
  if (tax) sourceRegions.tax = tax.region;

  const totalMinor = total?.minor ?? null;
  const subtotalMinor = subtotal?.minor ?? null;
  const taxMinor = tax?.minor ?? null;

  let arithmeticValid = false;
  if (subtotalMinor !== null && taxMinor !== null && totalMinor !== null) {
    arithmeticValid = subtotalMinor + taxMinor === totalMinor;
    if (!arithmeticValid) flags.push('arithmetic_mismatch');
  } else {
    flags.push('arithmetic_unverifiable');
  }

  const {
    vendorName,
    vendorId,
    region: vendorRegion,
  } = extractVendor(nonEmptyLines, knownVendors, flags);
  if (vendorRegion) sourceRegions.vendor = vendorRegion;

  const categoryId = matchCategory(fullText, knownCategories);
  if (!categoryId) flags.push('category_unmatched');

  return {
    vendorName,
    vendorId,
    date,
    currency,
    subtotalMinor,
    taxMinor,
    totalMinor,
    categoryId,
    arithmeticValid,
    fieldFlags: flags,
    sourceRegions,
  };
}

function extractCurrency(text: string, flags: string[]): string | null {
  const codeMatch = /\b(KES|USD|EUR|GBP|UGX|TZS|RWF|ZAR|NGN|GHS)\b/.exec(text.toUpperCase());
  if (codeMatch) return codeMatch[1] ?? null;
  for (const [symbol, code] of Object.entries(CURRENCY_SYMBOLS)) {
    if (text.includes(symbol)) return code;
  }
  if (/\bksh\b/i.test(text)) return 'KES';
  flags.push('currency_unresolved');
  return null;
}

function extractDate(text: string, flags: string[]): string | null {
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const slash = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/.exec(text);
  if (slash) {
    const first = Number(slash[1]);
    const second = Number(slash[2]);
    let year = slash[3] ?? '';
    if (year.length === 2) year = `20${year}`;
    // Unambiguous only when exactly one of the two components can't be a month (>12): otherwise the
    // day/month order is a genuine guess, and an incorrect guess on a financial record is worse than
    // leaving the field blank.
    const firstIsMonth = first <= 12;
    const secondIsMonth = second <= 12;
    if (firstIsMonth && !secondIsMonth) {
      return `${year}-${String(first).padStart(2, '0')}-${String(second).padStart(2, '0')}`;
    }
    if (secondIsMonth && !firstIsMonth) {
      return `${year}-${String(second).padStart(2, '0')}-${String(first).padStart(2, '0')}`;
    }
    flags.push('date_ambiguous');
    return null;
  }
  flags.push('date_unresolved');
  return null;
}

function extractAmount(
  lines: readonly ReceiptLine[],
  includeKeywords: readonly string[],
  excludeKeywords: readonly string[],
  flags: string[],
  fieldName: string,
): { minor: bigint; region: SourceRegion } | null {
  let best: { minor: bigint; region: SourceRegion } | null = null;
  lines.forEach((line, lineIndex) => {
    const lower = line.text.toLowerCase();
    if (!includeKeywords.some((keyword) => lower.includes(keyword))) return;
    if (excludeKeywords.some((keyword) => lower.includes(keyword))) return;
    const parsed = parseMoneyToMinor(line.text);
    if (parsed !== null) {
      best = {
        minor: parsed,
        region: { lineIndex, page: line.page, text: line.text, bbox: line.bbox },
      };
    }
  });
  if (best === null) flags.push(`${fieldName}_unresolved`);
  return best;
}

/** Matches the last (rightmost) decimal amount on a line -- receipts put the amount after the label. */
function parseMoneyToMinor(line: string): bigint | null {
  const matches = [...line.matchAll(/(\d[\d,]*)\.(\d{2})/g)];
  const match = matches.at(-1);
  if (!match) return null;
  const whole = match[1]?.replaceAll(',', '') ?? '';
  const cents = match[2] ?? '';
  if (!whole) return null;
  try {
    return BigInt(whole) * 100n + BigInt(cents);
  } catch {
    return null;
  }
}

function extractVendor(
  lines: readonly ReceiptLine[],
  knownVendors: readonly KnownVendor[],
  flags: string[],
): { vendorName: string | null; vendorId: string | null; region: SourceRegion | null } {
  const candidateIndex = lines.findIndex(
    (line) => line.text.length >= 2 && !/^\d+$/.test(line.text),
  );
  if (candidateIndex === -1) {
    flags.push('vendor_unresolved');
    return { vendorName: null, vendorId: null, region: null };
  }
  const candidateLine = lines[candidateIndex]!;
  const normalized = normalize(candidateLine.text);
  const match = knownVendors.find((vendor) => {
    const vendorNormalized = normalize(vendor.displayName);
    return (
      vendorNormalized === normalized ||
      normalized.includes(vendorNormalized) ||
      vendorNormalized.includes(normalized)
    );
  });
  if (!match) flags.push('vendor_unmatched');
  return {
    vendorName: candidateLine.text,
    vendorId: match?.id ?? null,
    region: {
      lineIndex: candidateIndex,
      page: candidateLine.page,
      text: candidateLine.text,
      bbox: candidateLine.bbox,
    },
  };
}

function matchCategory(text: string, knownCategories: readonly KnownCategory[]): string | null {
  const normalizedText = normalize(text);
  const match = knownCategories.find((category) =>
    normalizedText.includes(normalize(category.name)),
  );
  return match?.id ?? null;
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, ' ')
    .trim();
}
