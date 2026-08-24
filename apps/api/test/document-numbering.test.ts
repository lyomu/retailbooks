import { describe, expect, it } from 'vitest';

import {
  assertNumberingConfig,
  formatDocumentNumber,
  numberingScopeKey,
} from '../src/organizations/document-numbering';

describe('document numbering', () => {
  it('formats annual journal numbers with fiscal-year scope', () => {
    const scope = numberingScopeKey(new Date('2026-08-16T22:30:00.000Z'), {
      prefix: 'JRN',
      numberPadding: 5,
      numberingReset: 'ANNUAL',
      fiscalYearStartMonth: 1,
      fiscalYearStartDay: 1,
      timeZone: 'Africa/Nairobi',
    });

    expect(scope).toEqual({ key: 'FY2026', token: 'FY2026' });
    expect(formatDocumentNumber('jrn', 17, 5, scope.token)).toBe('JRN-FY2026-00017');
  });

  it('uses local month scope for monthly resets', () => {
    const nairobi = numberingScopeKey(new Date('2026-08-31T21:30:00.000Z'), {
      prefix: 'JRN',
      numberPadding: 4,
      numberingReset: 'MONTHLY',
      fiscalYearStartMonth: 1,
      fiscalYearStartDay: 1,
      timeZone: 'Africa/Nairobi',
    });
    const newYork = numberingScopeKey(new Date('2026-08-31T21:30:00.000Z'), {
      prefix: 'JRN',
      numberPadding: 4,
      numberingReset: 'MONTHLY',
      fiscalYearStartMonth: 1,
      fiscalYearStartDay: 1,
      timeZone: 'America/New_York',
    });

    expect(nairobi.key).toBe('2026-09');
    expect(newYork.key).toBe('2026-08');
  });

  it('uses one unscoped counter when resets are disabled', () => {
    expect(
      numberingScopeKey(new Date('2026-08-16T22:30:00.000Z'), {
        prefix: 'JRN',
        numberPadding: 5,
        numberingReset: 'NEVER',
        fiscalYearStartMonth: 1,
        fiscalYearStartDay: 1,
        timeZone: 'Africa/Nairobi',
      }),
    ).toEqual({ key: 'ALL', token: null });
  });

  it('rejects unsafe numbering configuration', () => {
    expect(() =>
      assertNumberingConfig({ prefix: 'bad prefix', numberPadding: 5, nextNumber: 1 }),
    ).toThrow();
    expect(() =>
      assertNumberingConfig({ prefix: 'JRN', numberPadding: 11, nextNumber: 1 }),
    ).toThrow();
    expect(() =>
      assertNumberingConfig({ prefix: 'JRN', numberPadding: 5, nextNumber: 0 }),
    ).toThrow();
  });
});
