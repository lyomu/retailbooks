import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../database/prisma.service.js';

export interface PolicyQaResult {
  readonly source: 'COUNTRY_PACK' | 'TAX_PACK' | 'DOCUMENT_RULE';
  readonly packCode: string;
  readonly packVersion: string;
  readonly documentType: string | null;
  readonly text: string;
}

const MAX_RESULTS = 20;

/**
 * Deterministic keyword lookup over the organization's actually-adopted, versioned country pack
 * (tax rates/exemptions/notes, document legal-field and footer requirements) -- no model call, and
 * every result cites the exact pack code/version it came from. This surfaces configured rules; it
 * is never legal or tax advice, and the UI must say so.
 */
@Injectable()
export class CountryPackQaService {
  constructor(private readonly prisma: PrismaService) {}

  async search(organizationId: string, query: string): Promise<PolicyQaResult[]> {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];

    const preference = await this.prisma.organizationPreference.findUnique({
      where: { organizationId },
      select: { countryPackCode: true, countryPackVersion: true },
    });
    if (!preference) return [];

    const pack = await this.prisma.countryPack.findUnique({
      where: {
        code_version: {
          code: preference.countryPackCode,
          version: preference.countryPackVersion,
        },
      },
      include: { taxPacks: true, documentRules: true },
    });
    if (!pack) return [];

    const citation = { packCode: pack.code, packVersion: pack.version };
    const entries: PolicyQaResult[] = [];

    for (const note of asStringArray(pack.notes)) {
      entries.push({ source: 'COUNTRY_PACK', ...citation, documentType: null, text: note });
    }
    for (const taxPack of pack.taxPacks) {
      for (const rate of asArray(taxPack.rates)) {
        if (rate && typeof rate === 'object' && 'label' in rate) {
          entries.push({
            source: 'TAX_PACK',
            ...citation,
            documentType: null,
            text: `${String(rate.label)}: ${JSON.stringify(rate)}`,
          });
        }
      }
      for (const note of asStringArray(taxPack.notes)) {
        entries.push({ source: 'TAX_PACK', ...citation, documentType: null, text: note });
      }
    }
    for (const rule of pack.documentRules) {
      if (rule.footerText) {
        entries.push({
          source: 'DOCUMENT_RULE',
          ...citation,
          documentType: rule.documentType,
          text: rule.footerText,
        });
      }
      for (const field of asStringArray(rule.requiredLegalFields)) {
        entries.push({
          source: 'DOCUMENT_RULE',
          ...citation,
          documentType: rule.documentType,
          text: `Required field: ${field}`,
        });
      }
    }

    return entries
      .filter((entry) => entry.text.toLowerCase().includes(needle))
      .slice(0, MAX_RESULTS);
  }
}

function asArray(value: Prisma.JsonValue): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asStringArray(value: Prisma.JsonValue): string[] {
  return asArray(value).filter((item): item is string => typeof item === 'string');
}
