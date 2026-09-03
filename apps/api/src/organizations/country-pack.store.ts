import { Injectable } from '@nestjs/common';
import type { CountryPack, CountryPackTier } from '@prisma/client';

import { PrismaService } from '../database/prisma.service.js';
import { countryPackSeedRows } from './country-pack.seed.js';
import { resolveCountryPack as resolveCatalogPack } from './jurisdiction-catalog.js';

export type ComplianceStatus = 'FULLY_REVIEWED' | 'GENERIC_CONFIGURATION' | 'UNSUPPORTED';

export interface ComplianceResolution {
  readonly status: ComplianceStatus;
  readonly packCode: string | null;
  readonly packVersion: string | null;
  readonly tier: CountryPackTier | null;
  readonly packName: string | null;
}

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
    // Checked per call rather than cached forever: a test harness (or an operator) truncating the
    // tables must be followed by a re-seed, not by a stale "already seeded" memory.
    const seededCount = await this.prisma.countryPack.count();
    if (seededCount >= countryPackSeedRows().length) return;
    if (!this.seedPromise) {
      // Concurrent callers share one in-flight seed; the cached promise is cleared when it
      // settles (success or failure), so a later truncation-and-reset still triggers a fresh
      // seed instead of silently reusing a promise that seeded rows now gone.
      this.seedPromise = this.seed().finally(() => {
        this.seedPromise = undefined;
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
      include: { taxPacks: true },
    });
  }

  /**
   * Derives an organization's compliance posture from its pinned pack. Derived, never stored: a
   * stored flag would go stale the moment a pack's tier changed underneath it. Tier A only counts
   * as fully reviewed while the pack is PUBLISHED -- a deprecated Tier A pack stops carrying
   * compliance claims immediately, and the seed path can never produce Tier A at all.
   */
  async resolveCompliance(
    code: string | null | undefined,
    version: string | null | undefined,
  ): Promise<ComplianceResolution> {
    await this.ensureSeeded();
    const normalizedCode = code?.trim().toUpperCase() || null;
    if (normalizedCode) {
      const pack = await this.resolve(normalizedCode, version ?? undefined);
      if (pack) {
        const complianceStatus: ComplianceStatus =
          pack.tier === 'TIER_A_REVIEWED' && pack.status === 'PUBLISHED'
            ? 'FULLY_REVIEWED'
            : pack.tier === 'TIER_C_BLOCKED'
              ? 'UNSUPPORTED'
              : 'GENERIC_CONFIGURATION';
        return {
          status: complianceStatus,
          packCode: pack.code,
          packVersion: pack.version,
          tier: pack.tier,
          packName: pack.name,
        };
      }
      // The static catalog is the fresh-database bootstrap fallback (D3): an unseeded deployment
      // still resolves its catalog packs as generic configuration rather than unsupported.
      const fallback = resolveCatalogPack(normalizedCode);
      if (fallback.code === normalizedCode) {
        return {
          status: 'GENERIC_CONFIGURATION',
          packCode: fallback.code,
          packVersion: fallback.version,
          tier: null,
          packName: fallback.name,
        };
      }
    }
    return {
      status: 'UNSUPPORTED',
      packCode: normalizedCode,
      packVersion: version ?? null,
      tier: null,
      packName: null,
    };
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
