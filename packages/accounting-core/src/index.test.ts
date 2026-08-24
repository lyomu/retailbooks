import { describe, expect, it } from 'vitest';

import {
  assertMinorUnitString,
  convertForeignMinorToBaseMinor,
  isBalancedJournal,
  normalBalanceForType,
  parseRatePercentToScaled,
  parseExchangeRateToScaled,
  reverseJournalLines,
  roundHalfUpDivide,
  signedMovement,
  splitInclusiveAmount,
  taxAmountExclusive,
  trialBalanceLine,
  validateJournalLines,
} from './index';

describe('normalBalanceForType', () => {
  it('maps account types to their normal accounting side', () => {
    expect(normalBalanceForType('ASSET')).toBe('DEBIT');
    expect(normalBalanceForType('EXPENSE')).toBe('DEBIT');
    expect(normalBalanceForType('LIABILITY')).toBe('CREDIT');
    expect(normalBalanceForType('REVENUE')).toBe('CREDIT');
  });
});

describe('isBalancedJournal', () => {
  it('accepts an equal non-zero debit and credit', () => {
    expect(
      isBalancedJournal([
        { debitMinor: 10_000n, creditMinor: 0n },
        { debitMinor: 0n, creditMinor: 10_000n },
      ]),
    ).toBe(true);
  });

  it('rejects an unbalanced journal', () => {
    expect(
      isBalancedJournal([
        { debitMinor: 10_000n, creditMinor: 0n },
        { debitMinor: 0n, creditMinor: 9_999n },
      ]),
    ).toBe(false);
  });

  it('reports line-level validation errors', () => {
    expect(
      validateJournalLines([
        { accountId: '', debitMinor: 10n, creditMinor: 0n },
        { accountId: 'cash', debitMinor: 1n, creditMinor: 1n },
      ]),
    ).toEqual(
      expect.arrayContaining([
        'Line 1 needs an account.',
        'Line 2 cannot have both debit and credit.',
        'Journal debits and credits must balance.',
      ]),
    );
  });
});

describe('reversal', () => {
  it('swaps debits and credits without changing accounts', () => {
    expect(
      reverseJournalLines([
        { accountId: 'cash', debitMinor: 500n, creditMinor: 0n },
        { accountId: 'sales', debitMinor: 0n, creditMinor: 500n },
      ]),
    ).toEqual([
      { accountId: 'cash', description: undefined, debitMinor: 0n, creditMinor: 500n },
      { accountId: 'sales', description: undefined, debitMinor: 500n, creditMinor: 0n },
    ]);
  });
});

describe('trial balance helpers', () => {
  it('keeps debit-normal account movements on the debit side', () => {
    expect(signedMovement('DEBIT', 150n, 25n)).toBe(125n);
    expect(
      trialBalanceLine({
        accountId: 'cash',
        accountCode: '1000',
        accountName: 'Cash',
        accountType: 'ASSET',
        normalBalance: 'DEBIT',
        movementMinor: 125n,
      }),
    ).toMatchObject({ debitMinor: 125n, creditMinor: 0n });
  });

  it('moves contra balances to the opposite trial-balance side', () => {
    expect(
      trialBalanceLine({
        accountId: 'cash',
        accountCode: '1000',
        accountName: 'Cash',
        accountType: 'ASSET',
        normalBalance: 'DEBIT',
        movementMinor: -30n,
      }),
    ).toMatchObject({ debitMinor: 0n, creditMinor: 30n });
  });
});

describe('minor-unit parsing', () => {
  it('accepts integer strings and rejects decimal strings', () => {
    expect(assertMinorUnitString('12345')).toBe(12345n);
    expect(assertMinorUnitString('-25')).toBe(-25n);
    expect(() => assertMinorUnitString('12.50')).toThrow();
  });
});

describe('parseRatePercentToScaled', () => {
  it('scales whole and 4dp decimal percents into integers', () => {
    expect(parseRatePercentToScaled('16')).toBe(160_000n);
    expect(parseRatePercentToScaled('0')).toBe(0n);
    expect(parseRatePercentToScaled('7.5')).toBe(75_000n);
    expect(parseRatePercentToScaled('7.1234')).toBe(71_234n);
  });

  it('rejects negative or over-precise values', () => {
    expect(() => parseRatePercentToScaled('-1')).toThrow();
    expect(() => parseRatePercentToScaled('1.23456')).toThrow();
  });
});

describe('roundHalfUpDivide', () => {
  it('rounds ties away from zero for positive and negative numerators', () => {
    expect(roundHalfUpDivide(5n, 2n)).toBe(3n);
    expect(roundHalfUpDivide(-5n, 2n)).toBe(-3n);
    expect(roundHalfUpDivide(4n, 2n)).toBe(2n);
  });

  it('is unbiased regardless of denominator parity', () => {
    expect(roundHalfUpDivide(3n, 4n)).toBe(1n);
    expect(roundHalfUpDivide(1n, 3n)).toBe(0n);
    expect(roundHalfUpDivide(2n, 3n)).toBe(1n);
  });
});

describe('taxAmountExclusive', () => {
  it('computes 16% VAT on a whole-currency base', () => {
    expect(taxAmountExclusive(10_000n, parseRatePercentToScaled('16'))).toBe(1_600n);
  });

  it('rounds a fractional-minor-unit result half up', () => {
    // 999 minor units at 16%: 159.84 -> rounds to 160
    expect(taxAmountExclusive(999n, parseRatePercentToScaled('16'))).toBe(160n);
  });

  it('returns zero tax for a zero rate', () => {
    expect(taxAmountExclusive(10_000n, parseRatePercentToScaled('0'))).toBe(0n);
  });

  it('handles 4dp rates deterministically', () => {
    expect(taxAmountExclusive(123_456n, parseRatePercentToScaled('7.1234'))).toBe(8_794n);
  });
});

describe('splitInclusiveAmount', () => {
  it('splits a tax-inclusive total so the parts reconstruct it exactly', () => {
    const result = splitInclusiveAmount(11_600n, parseRatePercentToScaled('16'));
    expect(result.baseMinor + result.taxMinor).toBe(11_600n);
    expect(result).toEqual({ baseMinor: 10_000n, taxMinor: 1_600n });
  });

  it('round-trips exactly across a range of totals and rates without float drift', () => {
    const rates = ['0', '16', '7.5', '20', '9.9999'];
    const totals = [0n, 1n, 99n, 1_000n, 12_345n, 999_999n];
    for (const rate of rates) {
      for (const total of totals) {
        const { baseMinor, taxMinor } = splitInclusiveAmount(total, parseRatePercentToScaled(rate));
        expect(baseMinor + taxMinor).toBe(total);
      }
    }
  });

  it('returns the full amount as base when the rate is zero', () => {
    expect(splitInclusiveAmount(5_000n, parseRatePercentToScaled('0'))).toEqual({
      baseMinor: 5_000n,
      taxMinor: 0n,
    });
  });
});

describe('exchange-rate conversion', () => {
  it('parses a Decimal(20,10)-compatible rate without floating point', () => {
    expect(parseExchangeRateToScaled('129.5')).toBe(1_295_000_000_000n);
    expect(parseExchangeRateToScaled('0.0091')).toBe(91_000_000n);
    expect(() => parseExchangeRateToScaled('0')).toThrow('greater than zero');
    expect(() => parseExchangeRateToScaled('1.12345678901')).toThrow('up to 10 places');
  });

  it('converts between currencies with equal and different minor-unit precision', () => {
    expect(
      convertForeignMinorToBaseMinor({
        foreignAmountMinor: 10_000n,
        exchangeRate: '129.5',
        baseMinorUnits: 2,
        quoteMinorUnits: 2,
      }),
    ).toBe(1_295_000n);

    expect(
      convertForeignMinorToBaseMinor({
        foreignAmountMinor: 1n,
        exchangeRate: '0.0091',
        baseMinorUnits: 2,
        quoteMinorUnits: 0,
      }),
    ).toBe(1n);
  });

  it('rounds once at the destination minor unit, including negative values', () => {
    expect(
      convertForeignMinorToBaseMinor({
        foreignAmountMinor: 1n,
        exchangeRate: '1.005',
        baseMinorUnits: 2,
        quoteMinorUnits: 2,
      }),
    ).toBe(1n);
    expect(
      convertForeignMinorToBaseMinor({
        foreignAmountMinor: -1n,
        exchangeRate: '1.5',
        baseMinorUnits: 2,
        quoteMinorUnits: 2,
      }),
    ).toBe(-2n);
  });
});
