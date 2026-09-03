import type { Prisma } from '@prisma/client';

import { countryPacks, findCountry, type CountryPackDefinition } from './jurisdiction-catalog.js';

/**
 * The D3 seed mapping: `jurisdiction-catalog.ts` is the seed source and the fresh-database
 * fallback for the DB-backed `CountryPack` entity. This module is a pure function of the static
 * catalog so the mapping is unit-testable without a database.
 *
 * Both shipped packs seed as TIER_B_GENERIC and PUBLISHED. Kenya keeps its explicit
 * _demonstration_ labelling through the migration -- seeding it as reviewed/published would be
 * exactly the compliance laundering D3 forbids. A TIER_A_REVIEWED pack only ever appears through
 * human review via Phase 12's admin console, never through this seed.
 */

/** Entity types a seeded pack carries defaults for. Deliberately conservative and explicit. */
const SEEDED_SUPPORTED_ENTITY_TYPES = ['INVOICE', 'CREDIT_NOTE', 'BILL', 'EXPENSE'] as const;

export interface CountryPackSeedTaxPack {
  readonly version: string;
  readonly name: string;
  readonly rates: Prisma.InputJsonObject[];
  readonly registrationFields: Prisma.InputJsonObject[];
  readonly exemptions: Prisma.InputJsonObject[];
  readonly reportingMappings: Prisma.InputJsonObject;
  readonly notes: Prisma.InputJsonValue[];
}

export interface CountryPackSeedRow {
  readonly code: string;
  readonly version: string;
  readonly countryCode: string;
  readonly name: string;
  readonly status: 'PUBLISHED';
  readonly tier: 'TIER_B_GENERIC';
  readonly defaults: Prisma.InputJsonObject;
  readonly notes: Prisma.InputJsonValue[];
  readonly supportedEntityTypes: Prisma.InputJsonValue[];
  readonly taxPack: CountryPackSeedTaxPack;
}

function buildTaxPack(pack: CountryPackDefinition): CountryPackSeedTaxPack {
  const country = findCountry(pack.countryCode);
  // The generic pack has no country behind it, so it seeds with no suggested rate: adopting
  // organizations configure tax themselves rather than inheriting another jurisdiction's guess.
  const rates: Prisma.InputJsonObject[] = country
    ? [
        {
          label: 'VAT',
          ratePercent: country.suggestedTaxRate,
          treatment: 'EXCLUSIVE',
          recoverable: true,
        },
      ]
    : [];
  const taxIdentifierLabel = country?.taxIdentifierLabel ?? 'Tax identification number';

  return {
    version: pack.version,
    name: `${pack.name} tax pack`,
    rates,
    registrationFields: [{ key: 'taxIdentifier', label: taxIdentifierLabel, required: false }],
    exemptions: [],
    reportingMappings: {},
    notes: ['Seeded software defaults, not a statutory certification or professional tax opinion.'],
  };
}

export function countryPackSeedRows(): CountryPackSeedRow[] {
  return countryPacks.map((pack) => ({
    code: pack.code,
    version: pack.version,
    countryCode: pack.countryCode,
    name: pack.name,
    status: 'PUBLISHED',
    tier: 'TIER_B_GENERIC',
    defaults: pack.defaults,
    notes: [...pack.notes],
    supportedEntityTypes: [...SEEDED_SUPPORTED_ENTITY_TYPES],
    taxPack: buildTaxPack(pack),
  }));
}
