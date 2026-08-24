import { describe, expect, it } from 'vitest';

import { rangesOverlap, resolveEffectiveRate } from '../src/organizations/tax-rate-resolution';

describe('resolveEffectiveRate', () => {
  const rates = [
    { id: 'r1', effectiveFrom: '2024-01-01', effectiveTo: '2024-12-31' },
    { id: 'r2', effectiveFrom: '2025-01-01', effectiveTo: null },
  ];

  it('resolves the range whose effectiveFrom boundary is inclusive', () => {
    expect(resolveEffectiveRate(rates, '2024-01-01')?.id).toBe('r1');
  });

  it('resolves the range whose effectiveTo boundary is inclusive', () => {
    expect(resolveEffectiveRate(rates, '2024-12-31')?.id).toBe('r1');
  });

  it('resolves an open-ended range for any date at or after its start', () => {
    expect(resolveEffectiveRate(rates, '2025-01-01')?.id).toBe('r2');
    expect(resolveEffectiveRate(rates, '2099-01-01')?.id).toBe('r2');
  });

  it('returns undefined for a date before any range starts', () => {
    expect(resolveEffectiveRate(rates, '2023-12-31')).toBeUndefined();
  });

  it('returns undefined for a date that falls in a gap between closed ranges', () => {
    const withGap = [
      { id: 'a', effectiveFrom: '2024-01-01', effectiveTo: '2024-06-30' },
      { id: 'b', effectiveFrom: '2024-08-01', effectiveTo: null },
    ];
    expect(resolveEffectiveRate(withGap, '2024-07-15')).toBeUndefined();
  });
});

describe('rangesOverlap', () => {
  it('detects a range fully contained within another', () => {
    expect(
      rangesOverlap(
        { effectiveFrom: '2024-01-01', effectiveTo: '2024-12-31' },
        { effectiveFrom: '2024-03-01', effectiveTo: '2024-06-30' },
      ),
    ).toBe(true);
  });

  it('detects a partial overlap at the start', () => {
    expect(
      rangesOverlap(
        { effectiveFrom: '2024-01-01', effectiveTo: '2024-06-30' },
        { effectiveFrom: '2024-06-01', effectiveTo: '2024-12-31' },
      ),
    ).toBe(true);
  });

  it('detects a partial overlap at the end', () => {
    expect(
      rangesOverlap(
        { effectiveFrom: '2024-06-01', effectiveTo: '2024-12-31' },
        { effectiveFrom: '2024-01-01', effectiveTo: '2024-06-30' },
      ),
    ).toBe(true);
  });

  it('treats an open-ended range as overlapping any later range', () => {
    expect(
      rangesOverlap(
        { effectiveFrom: '2024-01-01', effectiveTo: null },
        { effectiveFrom: '2030-01-01', effectiveTo: '2030-12-31' },
      ),
    ).toBe(true);
  });

  it('allows adjacent, non-overlapping ranges', () => {
    expect(
      rangesOverlap(
        { effectiveFrom: '2024-01-01', effectiveTo: '2024-06-30' },
        { effectiveFrom: '2024-07-01', effectiveTo: '2024-12-31' },
      ),
    ).toBe(false);
  });

  it('allows fully disjoint ranges', () => {
    expect(
      rangesOverlap(
        { effectiveFrom: '2020-01-01', effectiveTo: '2020-12-31' },
        { effectiveFrom: '2024-01-01', effectiveTo: '2024-12-31' },
      ),
    ).toBe(false);
  });
});
