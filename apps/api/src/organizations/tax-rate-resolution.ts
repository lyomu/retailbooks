export interface TaxRateRange {
  readonly id?: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
}

/**
 * True when two effective-dated ranges share at least one day. `effectiveTo: null` means open-ended
 * (still in effect). Ranges that only touch at a boundary (one ends the day before the other starts)
 * do not overlap.
 */
export function rangesOverlap(a: TaxRateRange, b: TaxRateRange): boolean {
  const aEnd = a.effectiveTo ?? '9999-12-31';
  const bEnd = b.effectiveTo ?? '9999-12-31';
  return a.effectiveFrom <= bEnd && b.effectiveFrom <= aEnd;
}

/**
 * Finds the rate range effective on a given date: `effectiveFrom <= asOfDate` and (open-ended or
 * `asOfDate <= effectiveTo`). Returns `undefined` when no range covers the date.
 */
export function resolveEffectiveRate<T extends TaxRateRange>(
  rates: readonly T[],
  asOfDate: string,
): T | undefined {
  return rates.find(
    (rate) =>
      rate.effectiveFrom <= asOfDate && (rate.effectiveTo === null || asOfDate <= rate.effectiveTo),
  );
}
