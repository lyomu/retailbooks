import { Injectable } from '@nestjs/common';
import type { CountryPack } from '@prisma/client';

import { PrismaService } from '../database/prisma.service.js';
import { countryPackSeedRows } from './country-pack.seed.js';

/**
 * DB-backed read path for country packs (D3: "readers move to the DB; the static file stays as
 * both the seed source and the fresh-database fallback").
 *
 * `ensureSeeded()` lazily upserts the catalog packs on first use, so a freshly migrated database
 * works with no manual seed step, and re-running is idempotent as pack rows evolve alongside the
 * catalog. All reads go through here rather than touching the static catalog directly, which is
 * what lets Phase 12's admin console version/publish/deprecate packs without a second source of
 * truth appearing later.
 */
@Injectable()
export class CountryPackStore {
  constructor(private readonly prisma: PrismaService) {}

  private seedPromise?: Promise<void>;

  async ensureSeeded(): Promise<void> {
    if (!this.seedPromise) {
      // Reset on failure so a transient database error does not poison every later read for the
      // life of the process.
      this.seedPromise = this.seed().catch((error: unknown) => {
        this.seedPromise = undefined;
        throw error;
      });
    }
    await this.seedPromise;
  }

  /** Resolve a specific pack version; without a version, the latest published one for the code. */
  async resolve(code: string, version?: string): Promise<CountryPack | null> {
    await this.ensureSeeded();
    if (version) {
      return this.prisma.countryPack.findUnique({
        where: { code_version: { code: code.toUpperCase(), version } },
      });
    }
    return this.prisma.countryPack.findFirst({
      where: { code: code.toUpperCase(), status: 'PUBLISHED' },
      orderBy: { publishedAt: 'desc' },
    });
  }

  async listPublished(): Promise<CountryPack[]> {
    await this.ensureSeeded();
    return this.prisma.countryPack.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: [{ code: 'asc' }, { version: 'desc' }],
    });
  }

  private async seed(): Promise<void> {
    for (const row of countryPackSeedRows()) {
      const pack = await this.prisma.countryPack.upsert({
        where: { code_version: { code: row.code, version: row.version } },
        create: {
          code: row.code,
          version: row.version,
          countryCode: row.countryCode,
          name: row.name,
          status: row.status,
          tier: row.tier,
          defaults: row.defaults,
          notes: row.notes,
          supportedEntityTypes: row.supportedEntityTypes,
          publishedAt: new Date(),
        },
        update: {
          countryCode: row.countryCode,
          name: row.name,
          defaults: row.defaults,
          notes: row.notes,
          supportedEntityTypes: row.supportedEntityTypes,
        },
      });
      // Deliberately status/tier are NOT in the update branch: seeding must never resurrect a
      // deprecated pack or downgrade a tier a reviewer has raised. Those change only through the
      // Phase 12 admin path.
      await this.prisma.taxPack.upsert({
        where: {
          countryPackId_version: { countryPackId: pack.id, version: row.taxPack.version },
        },
        create: {
          countryPackId: pack.id,
          version: row.taxPack.version,
          name: row.taxPack.name,
          rates: row.taxPack.rates,
          registrationFields: row.taxPack.registrationFields,
          exemptions: row.taxPack.exemptions,
          reportingMappings: row.taxPack.reportingMappings,
          notes: row.taxPack.notes,
        },
        update: {
          name: row.taxPack.name,
          rates: row.taxPack.rates,
          registrationFields: row.taxPack.registrationFields,
          exemptions: row.taxPack.exemptions,
          reportingMappings: row.taxPack.reportingMappings,
          notes: row.taxPack.notes,
        },
      });
    }
  }
}
