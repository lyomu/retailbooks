import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import type { PublicUser } from '../auth/auth.service.js';
import type { RequestMetadata } from '../auth/request-context.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  assertNumberingConfig,
  formatDocumentNumber,
  JOURNAL_DOCUMENT_TYPE,
  numberingScopeKey,
} from './document-numbering.js';
import type { OrganizationContext } from './organization-context.js';
import type { UpdateJournalNumberingDto } from './organization.dto.js';

@Injectable()
export class DocumentNumberingService {
  constructor(private readonly prisma: PrismaService) {}

  async detail(organizationId: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        fiscalYearStartMonth: true,
        fiscalYearStartDay: true,
        timeZone: true,
        preferences: {
          select: {
            journalPrefix: true,
            numberPadding: true,
            nextJournalNumber: true,
            numberingReset: true,
          },
        },
        documentNumbers: {
          where: { documentType: JOURNAL_DOCUMENT_TYPE },
          orderBy: [{ scopeKey: 'desc' }],
        },
      },
    });
    if (!organization?.preferences) throw new NotFoundException('Organization not found.');

    const currentScope = numberingScopeKey(new Date(), {
      prefix: organization.preferences.journalPrefix,
      numberPadding: organization.preferences.numberPadding,
      numberingReset: organization.preferences.numberingReset,
      fiscalYearStartMonth: organization.fiscalYearStartMonth,
      fiscalYearStartDay: organization.fiscalYearStartDay,
      timeZone: organization.timeZone,
    });

    return {
      journal: {
        prefix: organization.preferences.journalPrefix,
        numberPadding: organization.preferences.numberPadding,
        nextJournalNumber: organization.preferences.nextJournalNumber,
        numberingReset: organization.preferences.numberingReset,
        currentScope,
        sequences: organization.documentNumbers.map((sequence) => ({
          id: sequence.id,
          documentType: sequence.documentType,
          scopeKey: sequence.scopeKey,
          prefix: sequence.prefix,
          numberPadding: sequence.numberPadding,
          numberingReset: sequence.numberingReset,
          nextNumber: sequence.nextNumber,
          lastAllocatedNumber: sequence.lastAllocatedNumber,
          lastAllocatedAt: sequence.lastAllocatedAt?.toISOString() ?? null,
        })),
      },
    };
  }

  async updateJournalConfig(
    context: OrganizationContext,
    user: PublicUser,
    input: UpdateJournalNumberingDto,
    metadata: RequestMetadata,
  ) {
    const current = await this.prisma.organization.findUnique({
      where: { id: context.id },
      select: {
        fiscalYearStartMonth: true,
        fiscalYearStartDay: true,
        timeZone: true,
        preferences: {
          select: {
            journalPrefix: true,
            numberPadding: true,
            nextJournalNumber: true,
            numberingReset: true,
          },
        },
      },
    });
    if (!current?.preferences) throw new NotFoundException('Organization not found.');

    const next = {
      prefix: input.journalPrefix ?? current.preferences.journalPrefix,
      numberPadding: input.numberPadding ?? current.preferences.numberPadding,
      nextNumber: input.nextJournalNumber ?? current.preferences.nextJournalNumber,
      numberingReset: input.numberingReset ?? current.preferences.numberingReset,
    };

    try {
      assertNumberingConfig(next);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Invalid numbering.');
    }

    const scope = numberingScopeKey(new Date(), {
      prefix: next.prefix,
      numberPadding: next.numberPadding,
      numberingReset: next.numberingReset,
      fiscalYearStartMonth: current.fiscalYearStartMonth,
      fiscalYearStartDay: current.fiscalYearStartDay,
      timeZone: current.timeZone,
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.organizationPreference.update({
        where: { organizationId: context.id },
        data: {
          journalPrefix: next.prefix,
          numberPadding: next.numberPadding,
          nextJournalNumber: next.nextNumber,
          numberingReset: next.numberingReset,
        },
      });

      await tx.documentNumberSequence.upsert({
        where: {
          organizationId_documentType_scopeKey: {
            organizationId: context.id,
            documentType: JOURNAL_DOCUMENT_TYPE,
            scopeKey: scope.key,
          },
        },
        create: {
          organizationId: context.id,
          documentType: JOURNAL_DOCUMENT_TYPE,
          scopeKey: scope.key,
          prefix: next.prefix,
          numberPadding: next.numberPadding,
          numberingReset: next.numberingReset,
          nextNumber: next.nextNumber,
        },
        update: {
          prefix: next.prefix,
          numberPadding: next.numberPadding,
          numberingReset: next.numberingReset,
          nextNumber: next.nextNumber,
        },
      });

      await event(tx, user.id, context.id, 'numbering.journal_config_updated', metadata, {
        before: current.preferences,
        after: next,
        scopeKey: scope.key,
      });
    });

    return this.detail(context.id);
  }

  async allocateJournalNumber(organizationId: string, at: Date = new Date()) {
    return this.allocateJournalNumberWithClient(this.prisma, organizationId, at);
  }

  async allocateJournalNumberWithClient(
    client: Prisma.TransactionClient | PrismaService,
    organizationId: string,
    at: Date = new Date(),
  ) {
    const organization = await client.organization.findUnique({
      where: { id: organizationId },
      select: {
        fiscalYearStartMonth: true,
        fiscalYearStartDay: true,
        timeZone: true,
        preferences: {
          select: {
            journalPrefix: true,
            numberPadding: true,
            nextJournalNumber: true,
            numberingReset: true,
          },
        },
      },
    });
    if (!organization?.preferences) throw new NotFoundException('Organization not found.');

    const config = {
      prefix: organization.preferences.journalPrefix,
      numberPadding: organization.preferences.numberPadding,
      numberingReset: organization.preferences.numberingReset,
      fiscalYearStartMonth: organization.fiscalYearStartMonth,
      fiscalYearStartDay: organization.fiscalYearStartDay,
      timeZone: organization.timeZone,
    };
    const scope = numberingScopeKey(at, config);

    const [sequence] = await client.$queryRaw<
      {
        prefix: string;
        number_padding: number;
        scope_key: string;
        last_allocated_number: number;
      }[]
    >`
      INSERT INTO document_number_sequences (
        organization_id,
        document_type,
        scope_key,
        prefix,
        number_padding,
        numbering_reset,
        next_number,
        last_allocated_number,
        last_allocated_at
      )
      VALUES (
        ${organizationId}::uuid,
        ${JOURNAL_DOCUMENT_TYPE},
        ${scope.key},
        ${config.prefix},
        ${config.numberPadding},
        ${organization.preferences.numberingReset}::"NumberingReset",
        ${organization.preferences.nextJournalNumber + 1},
        ${organization.preferences.nextJournalNumber},
        ${at}
      )
      ON CONFLICT (organization_id, document_type, scope_key)
      DO UPDATE SET
        prefix = EXCLUDED.prefix,
        number_padding = EXCLUDED.number_padding,
        numbering_reset = EXCLUDED.numbering_reset,
        last_allocated_number = document_number_sequences.next_number,
        last_allocated_at = EXCLUDED.last_allocated_at,
        next_number = document_number_sequences.next_number + 1,
        updated_at = CURRENT_TIMESTAMP
      RETURNING prefix, number_padding, scope_key, last_allocated_number
    `;

    if (!sequence) throw new BadRequestException('Could not allocate a document number.');

    return {
      documentType: JOURNAL_DOCUMENT_TYPE,
      scopeKey: sequence.scope_key,
      sequenceNumber: sequence.last_allocated_number,
      value: formatDocumentNumber(
        sequence.prefix,
        sequence.last_allocated_number,
        sequence.number_padding,
        scope.token,
      ),
      allocatedAt: at.toISOString(),
    };
  }
}

function event(
  tx: Prisma.TransactionClient,
  userId: string,
  organizationId: string,
  eventKey: string,
  metadata: RequestMetadata,
  details: Prisma.InputJsonObject,
) {
  return tx.securityEvent.create({
    data: { userId, organizationId, eventKey, ipHash: metadata.ipHash, metadata: details },
  });
}
