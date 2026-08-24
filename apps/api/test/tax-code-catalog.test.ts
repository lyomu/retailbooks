import { describe, expect, it } from 'vitest';

import { DEFAULT_ROLE_PERMISSIONS, PERMISSION_KEYS } from '../src/organizations/permission-catalog';
import { starterTaxCodesForCountryPack } from '../src/organizations/tax-code-catalog';

describe('starterTaxCodesForCountryPack', () => {
  it('seeds Kenya standard, zero-rated, and exempt VAT codes', () => {
    const codes = starterTaxCodesForCountryPack('KE');
    const byCode = new Map(codes.map((code) => [code.code, code]));

    expect(byCode.get('VAT-STD')).toMatchObject({
      treatment: 'EXCLUSIVE',
      recoverable: true,
      salesTaxAccountCode: '2050',
      purchaseTaxAccountCode: '1400',
    });
    expect(byCode.get('VAT-ZERO')).toMatchObject({ treatment: 'EXCLUSIVE', recoverable: true });
    expect(byCode.get('VAT-EXEMPT')).toMatchObject({ treatment: 'EXCLUSIVE', recoverable: false });
    expect(byCode.get('VAT-EXEMPT')?.salesTaxAccountCode).toBeUndefined();
    expect(byCode.get('VAT-EXEMPT')?.purchaseTaxAccountCode).toBeUndefined();
  });

  it('has no duplicate codes for any known pack', () => {
    for (const pack of ['KE', 'GENERIC']) {
      const codes = starterTaxCodesForCountryPack(pack).map((code) => code.code);
      expect(new Set(codes).size).toBe(codes.length);
    }
  });

  it('falls back to a single non-recoverable placeholder code for unknown packs', () => {
    const codes = starterTaxCodesForCountryPack('ZZ');
    expect(codes).toHaveLength(1);
    expect(codes[0]).toMatchObject({ code: 'NO-TAX', recoverable: false });
  });
});

describe('tax permission defaults', () => {
  it('adds tax.codes.* keys without disturbing existing owner totality', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.OWNER).toEqual(PERMISSION_KEYS);
    expect(DEFAULT_ROLE_PERMISSIONS.ADMIN).toContain('tax.codes.manage');
    expect(DEFAULT_ROLE_PERMISSIONS.ACCOUNTANT).toContain('tax.codes.manage');
    expect(DEFAULT_ROLE_PERMISSIONS.STAFF).toContain('tax.codes.view');
    expect(DEFAULT_ROLE_PERMISSIONS.STAFF).not.toContain('tax.codes.manage');
  });
});
