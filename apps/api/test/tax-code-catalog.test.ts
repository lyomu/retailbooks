import { describe, expect, it } from 'vitest';

import { starterTaxCodesForCountryPack } from '../src/organizations/tax-code-catalog';
import { SYSTEM_ROLE_TEMPLATES } from '../src/organizations/roles-catalog';

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
    const owner = SYSTEM_ROLE_TEMPLATES.find((t) => t.key === 'OWNER');
    const admin = SYSTEM_ROLE_TEMPLATES.find((t) => t.key === 'ADMIN');
    const accountant = SYSTEM_ROLE_TEMPLATES.find((t) => t.key === 'ACCOUNTANT');
    const viewer = SYSTEM_ROLE_TEMPLATES.find((t) => t.key === 'VIEWER');

    expect(owner?.isOwnerRole).toBe(true);
    expect(admin?.permissions).toContain('tax.codes.manage');
    expect(accountant?.permissions).toContain('tax.codes.manage');
    expect(viewer?.permissions).toContain('tax.codes.view');
    expect(viewer?.permissions).not.toContain('tax.codes.manage');
  });
});
