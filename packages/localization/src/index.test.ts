import { describe, expect, it } from 'vitest';

import {
  formatCurrency,
  formatDateInTimeZone,
  formatDateTimeInTimeZone,
  formatFinancialNumber,
  getCurrencyMinorUnits,
  kenyaCountryPack,
  localIsoDate,
  resolveCountryPack,
  roundCurrencyAmount,
} from './index';

describe('country-pack resolution', () => {
  it('declares Kenya as configurable demonstration defaults', () => {
    expect(kenyaCountryPack).toMatchObject({
      code: 'KE',
      version: '2026.1-draft',
      countryCode: 'KE',
      status: 'DEMONSTRATION',
      defaults: {
        currency: 'KES',
        locale: 'en-KE',
        timeZone: 'Africa/Nairobi',
      },
    });
    expect(kenyaCountryPack.notes.join(' ')).toContain('not a statutory certification');
  });

  it('falls back to the generic pack for unknown codes', () => {
    expect(resolveCountryPack('missing')).toMatchObject({
      code: 'GENERIC',
      status: 'GENERIC_FALLBACK',
    });
  });
});

describe('currency and financial formatting', () => {
  it('uses catalogued minor units for zero-decimal currencies', () => {
    expect(getCurrencyMinorUnits('UGX')).toBe(0);
    expect(roundCurrencyAmount(123.67, 'UGX')).toBe(124);
  });

  it('formats KES with two minor units', () => {
    expect(formatCurrency(1234.5, { locale: 'en-KE', currency: 'KES' })).toContain('1,234.50');
  });

  it('formats negative accounting values with parentheses when requested', () => {
    expect(formatFinancialNumber(-1250.5, { locale: 'en-US', accounting: true })).toBe(
      '(1,250.50)',
    );
  });
});

describe('time-zone formatting', () => {
  it('derives local dates in the configured time zone', () => {
    const instant = new Date('2026-08-16T22:30:00.000Z');
    expect(localIsoDate(instant, 'Africa/Nairobi')).toBe('2026-08-17');
    expect(localIsoDate(instant, 'America/New_York')).toBe('2026-08-16');
  });

  it('formats dates and date-times without changing the input instant', () => {
    const instant = '2026-08-16T22:30:00.000Z';
    expect(
      formatDateInTimeZone(instant, { locale: 'en-KE', timeZone: 'Africa/Nairobi' }),
    ).toContain('17');
    expect(
      formatDateTimeInTimeZone(instant, { locale: 'en-KE', timeZone: 'Africa/Nairobi' }),
    ).toContain('2026');
  });
});
