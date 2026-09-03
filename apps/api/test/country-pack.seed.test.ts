import { describe, expect, it } from 'vitest';

import { countryPackSeedRows } from '../src/organizations/country-pack.seed';
import { countryPacks } from '../src/organizations/jurisdiction-catalog';

describe('countryPackSeedRows', () => {
  it('maps every pack in the static catalog, with no extras', () => {
    const rows = countryPackSeedRows();
    expect(rows.map((row) => row.code)).toEqual(countryPacks.map((pack) => pack.code));
  });

  it('seeds Kenya as a published demonstration pack without implying compliance', () => {
    const ke = countryPackSeedRows().find((row) => row.code === 'KE');
    expect(ke).toMatchObject({
      version: '2026.1-draft',
      countryCode: 'KE',
      status: 'PUBLISHED',
      tier: 'TIER_B_GENERIC',
    });
    expect(ke?.defaults).toMatchObject({ currency: 'KES', locale: 'en-KE' });
    // The demonstration labelling must survive the promotion to the database: the notes are the
    // model's honesty mechanism, so dropping or softening them here would be the exact
    // compliance laundering decision D3 forbids.
    const notes = JSON.stringify(ke?.notes);
    expect(notes).toContain('statutory certification');
  });

  it('seeds the generic fallback with no suggested tax rate', () => {
    const generic = countryPackSeedRows().find((row) => row.code === 'GENERIC');
    expect(generic).toMatchObject({ countryCode: 'ZZ', tier: 'TIER_B_GENERIC' });
    expect(generic?.taxPack.rates).toEqual([]);
  });

  it('derives the Kenya tax pack from the country catalog', () => {
    const ke = countryPackSeedRows().find((row) => row.code === 'KE');
    expect(ke?.taxPack).toMatchObject({
      version: '2026.1-draft',
      rates: [{ label: 'VAT', ratePercent: 16, treatment: 'EXCLUSIVE', recoverable: true }],
      registrationFields: [{ key: 'taxIdentifier', label: 'KRA PIN', required: false }],
    });
  });

  it('seeds every pack at tier B, so only human review can create a tier A pack', () => {
    for (const row of countryPackSeedRows()) {
      expect(row.tier).toBe('TIER_B_GENERIC');
    }
  });
});
