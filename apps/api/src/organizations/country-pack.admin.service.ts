import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { CountryPack } from '@prisma/client';

import { PrismaService } from '../database/prisma.service.js';
import {
  assertPackDefaultsShape,
  type CreateCountryPackDto,
  type UpdateCountryPackDto,
} from './country-pack.dto.js';

/**
 * Mutations for the versioned `CountryPack` entity: draft creation, draft edits, publishing,
 * deprecating, and draft deletion. Only a platform administrator reaches these through HTTP
 * (`PlatformAdminGuard`); the seed path in `CountryPackStore` deliberately cannot do any of this
 * beyond upserting its own catalog rows, so seeding can never publish a new tier or resurrect a
 * deprecated pack.
 *
 * Status transitions are one-way and narrow: DRAFT -> PUBLISHED -> DEPRECATED. A deprecated pack
 * is never edited or re-published -- the fix is a new version, which is what versioning is for.
 */
@Injectable()
export class CountryPackAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async listAll(): Promise<(CountryPack & { taxPacks: unknown[] })[]> {
    return this.prisma.countryPack.findMany({
      orderBy: [{ code: 'asc' }, { version: 'desc' }],
      include: { taxPacks: true },
    });
  }

  async createDraft(input: CreateCountryPackDto): Promise<CountryPack> {
    assertPackDefaultsShape(input.defaults);
    const existing = await this.prisma.countryPack.findUnique({
      where: { code_version: { code: input.code, version: input.version } },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('A country pack with that code and version already exists.');
    }
    try {
      return await this.prisma.countryPack.create({
        data: {
          code: input.code,
          version: input.version,
          countryCode: input.countryCode,
          name: input.name,
          tier: input.tier,
          status: 'DRAFT',
          defaults: input.defaults,
          notes: input.notes ?? [],
          supportedEntityTypes: input.supportedEntityTypes ?? [],
          taxPacks: input.taxPack
            ? {
                create: {
                  version: input.taxPack.version,
                  name: input.taxPack.name,
                  rates: input.taxPack.rates,
                  registrationFields: input.taxPack.registrationFields ?? [],
                  exemptions: input.taxPack.exemptions ?? [],
                  reportingMappings: input.taxPack.reportingMappings ?? {},
                  notes: input.taxPack.notes ?? [],
                },
              }
            : undefined,
        },
      });
    } catch {
      // The pre-check above catches the expected race; this backs the unique constraint.
      throw new ConflictException('A country pack with that code and version already exists.');
    }
  }

  async updateDraft(
    code: string,
    version: string,
    input: UpdateCountryPackDto,
  ): Promise<CountryPack> {
    const pack = await this.findOrThrow(code, version);
    if (pack.status !== 'DRAFT') {
      throw new ConflictException(
        'Only draft packs can be edited; publish a new version to change a live pack.',
      );
    }
    if (input.defaults) assertPackDefaultsShape(input.defaults);
    return this.prisma.countryPack.update({
      where: { id: pack.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.tier !== undefined ? { tier: input.tier } : {}),
        ...(input.defaults !== undefined ? { defaults: input.defaults } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.supportedEntityTypes !== undefined
          ? { supportedEntityTypes: input.supportedEntityTypes }
          : {}),
      },
    });
  }

  async publish(code: string, version: string): Promise<CountryPack> {
    const pack = await this.findOrThrow(code, version);
    if (pack.status !== 'DRAFT') {
      throw new ConflictException('Only draft packs can be published.');
    }
    return this.prisma.countryPack.update({
      where: { id: pack.id },
      data: { status: 'PUBLISHED', publishedAt: new Date(), deprecatedAt: null },
    });
  }

  async deprecate(code: string, version: string): Promise<CountryPack> {
    const pack = await this.findOrThrow(code, version);
    if (pack.status !== 'PUBLISHED') {
      throw new ConflictException('Only published packs can be deprecated.');
    }
    return this.prisma.countryPack.update({
      where: { id: pack.id },
      data: { status: 'DEPRECATED', deprecatedAt: new Date() },
    });
  }

  async deleteDraft(code: string, version: string): Promise<void> {
    const pack = await this.findOrThrow(code, version);
    if (pack.status !== 'DRAFT') {
      throw new ConflictException(
        'Only draft packs can be deleted; deprecate a published pack instead.',
      );
    }
    await this.prisma.countryPack.delete({ where: { id: pack.id } });
  }

  private async findOrThrow(code: string, version: string): Promise<CountryPack> {
    const pack = await this.prisma.countryPack.findUnique({
      where: { code_version: { code: code.toUpperCase(), version } },
    });
    if (!pack) throw new NotFoundException('Country pack version not found.');
    return pack;
  }
}
