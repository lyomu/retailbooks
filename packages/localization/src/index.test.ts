import { describe, expect, it } from 'vitest';

import { kenyaCountryPack } from './index';

describe('Kenya country-pack identity', () => {
  it('declares portable locale defaults', () => {
    expect(kenyaCountryPack).toMatchObject({
      code: 'KE',
      defaultCurrency: 'KES',
      defaultLocale: 'en-KE',
      defaultTimeZone: 'Africa/Nairobi',
    });
  });
});
