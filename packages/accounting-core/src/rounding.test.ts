import { describe, expect, it } from 'vitest';

import { computeCashRoundingDelta } from './index.js';

describe('computeCashRoundingDelta', () => {
  it('rounds half-up to the nearest unit and returns the signed delta', () => {
    // Unit = 50 minor (nearest half-major on 2-decimal currencies).
    expect(computeCashRoundingDelta(101n, 50n)).toBe(-1n); // 1.01 -> 1.00
    expect(computeCashRoundingDelta(124n, 50n)).toBe(-24n); // 1.24 -> 1.00
    expect(computeCashRoundingDelta(126n, 50n)).toBe(24n); // 1.26 -> 1.50
    expect(computeCashRoundingDelta(149n, 50n)).toBe(1n); // 1.49 -> 1.50
    expect(computeCashRoundingDelta(150n, 50n)).toBe(0n);
    expect(computeCashRoundingDelta(100n, 50n)).toBe(0n);
  });

  it('returns zero when the unit disables rounding', () => {
    expect(computeCashRoundingDelta(123n, 0n)).toBe(0n);
    expect(computeCashRoundingDelta(123n, -5n)).toBe(0n);
    expect(computeCashRoundingDelta(123n, 1n)).toBe(0n);
  });

  it('handles negative amounts symmetrically', () => {
    expect(computeCashRoundingDelta(-101n, 50n)).toBe(1n); // -1.01 -> -1.00
    expect(computeCashRoundingDelta(-124n, 50n)).toBe(24n); // -1.24 -> -1.00 (nearest multiple)
  });
});
