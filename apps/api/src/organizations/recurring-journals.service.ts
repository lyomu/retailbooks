import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, LedgerAccountStatus, type Prisma } from '@prisma/client';

import type { PublicUser } from '../auth/auth.service.js';
import type { RequestMetadata } from '../auth/request-context.js';
import { advanceCadence } from '../common/cadence.js';
import { PrismaService } from '../database/prisma.service.js';
import type { PostingRule, PostingRuleSourceContext } from '../posting-rules/posting-rule.js';
import { accountIdRef } from '../posting-rules/posting-rule.js';
import { PostingRulesService } from '../posting-rules/posting-rules.service.js';
import { writeAuditEvent } from './audit-event.js';
import type {
  CreateRecurringJournalTemplateDto,
  RecurringJournalLineDto,
  UpdateRecurringJournalTemplateDto,
} from './recurring-journals.dto.js';
import type { OrganizationContext } from './organization-context.js';

const RECURRING_JOURNAL_GENERATE_OPERATION = 'RECURRING_JOURNAL_GENERATE';
// Distinct from the posting idempotency namespace above: the claim marks "this occurrence is being
// generated", while the rule executor records "this journal was posted". Sharing one namespace
// would make the executor mistake the claim for its own completion record.
const RECURRING_JOURNAL_CLAIM_OPERATION = 'RECURRING_JOURNAL_CLAIM';

type TemplateWithLines = Prisma.RecurringJournalTemplateGetPayload<{
  include: { lines: true };
}>;

interface GenerateSource extends PostingRuleSourceContext {
  name: string;
  occurrenceDate: string;
  lines: readonly {
    accountId: string;
    description?: string;
    debitMinor: bigint;
    creditMinor: bigint;
  }[];
}

/**
 * Recurring Journal templates: a cadence-driven schedule of balanced manual journals (rent,
 * depreciation, accruals). Generation mirrors the Phase 3 recurring modules' `claimOccurrence`
 * atomicity primitive -- advisory lock + `LedgerIdempotencyKey` check-and-record -- so duplicate
 * sweeps can never double-generate for the same occurrence, and each generated journal posts
 * through the declarative rule library (`sourceType 'RECURRING_JOURNAL'`), unique per occurrence.
 */
@Injectable()
export class RecurringJournalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rules: PostingRulesService,
  ) {}

  private readonly generateRule: PostingRule<GenerateSource> = {
    event: RECURRING_JOURNAL_GENERATE_OPERATION,
    sourceType: 'RECURRING_JOURNAL',
    version: 1,
    describe: (source) => `${source.name} â€” recurring journal for ${source.occurrenceDate}`,
    lines: (source) =>
      source.lines.map((line) => ({
        account: accountIdRef(line.accountId),
        description: line.description,
        debitMinor: line.debitMinor,
        creditMinor: line.creditMinor,
      })),
  };

  async list(organizationId: string, active?: string) {
    const templates = await this.prisma.recurringJournalTemplate.findMany({
      where: {
        organizationId,
        ...(active !== undefined ? { active: active === 'true' } : {}),
      },
      orderBy: [{ createdAt: 'desc' }],
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
      take: 200,
    });
    return templates.map(summarizeTemplate);
  }

  async detail(organizationId: string, templateId: string) {
    return summarizeTemplate(await this.findOrThrow(organizationId, templateId));
  }

  async createTemplate(
    context: OrganizationContext,
    user: PublicUser,
    input: CreateRecurringJournalTemplateDto,
    metadata: RequestMetadata,
  ) {
    const resolvedLines = await this.resolveLines(context.id, input.lines);
    this.validateBalanced(resolvedLines);
    const startDate = isoDate(input.startDate);
    const endDate = input.endDate ? isoDate(input.endDate) : null;
    if (endDate && endDate < startDate) {
      throw new BadRequestException('endDate cannot be before startDate.');
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const template = await tx.recurringJournalTemplate.create({
        data: {
          organizationId: context.id,
          name: input.name,
          memo: input.memo,
          cadence: input.cadence,
          startDate,
          endDate,
          nextRunDate: startDate,
          createdByUserId: user.id,
          lines: {
            create: resolvedLines.map((line, index) => ({
              organizationId: context.id,
              lineNumber: index + 1,
              accountId: line.accountId,
              debitMinor: line.debitMinor,
              creditMinor: line.creditMinor,
              description: line.description ?? null,
            })),
          },
        },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'journals.recurring_template_created',
        entityType: 'recurring_journal_template',
        entityId: template.id,
        action: AuditAction.CREATE,
        after: { name: template.name, cadence: template.cadence },
        ipHash: metadata.ipHash,
      });
      return template;
    });

    return summarizeTemplate(created);
  }

  async updateTemplate(
    context: OrganizationContext,
    user: PublicUser,
    templateId: string,
    input: UpdateRecurringJournalTemplateDto,
    metadata: RequestMetadata,
  ) {
    const existing = await this.findOrThrow(context.id, templateId);
    const resolvedLines = input.lines ? await this.resolveLines(context.id, input.lines) : null;
    if (resolvedLines) this.validateBalanced(resolvedLines);
    const endDate = input.endDate !== undefined ? isoDate(input.endDate) : existing.endDate;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (resolvedLines) {
        await tx.recurringJournalTemplateLine.deleteMany({ where: { templateId } });
      }
      const template = await tx.recurringJournalTemplate.update({
        where: { id: templateId },
        data: {
          name: input.name ?? existing.name,
          memo: input.memo ?? existing.memo,
          cadence: input.cadence ?? existing.cadence,
          endDate,
          ...(resolvedLines
            ? {
                lines: {
                  create: resolvedLines.map((line, index) => ({
                    organizationId: context.id,
                    lineNumber: index + 1,
                    accountId: line.accountId,
                    debitMinor: line.debitMinor,
                    creditMinor: line.creditMinor,
                    description: line.description ?? null,
                  })),
                },
              }
            : {}),
        },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'journals.recurring_template_updated',
        entityType: 'recurring_journal_template',
        entityId: templateId,
        action: AuditAction.UPDATE,
        ipHash: metadata.ipHash,
      });
      return template;
    });

    return summarizeTemplate(updated);
  }

  async deactivate(
    context: OrganizationContext,
    user: PublicUser,
    templateId: string,
    metadata: RequestMetadata,
  ) {
    return this.setActive(context, user, templateId, false, metadata);
  }

  async reactivate(
    context: OrganizationContext,
    user: PublicUser,
    templateId: string,
    metadata: RequestMetadata,
  ) {
    return this.setActive(context, user, templateId, true, metadata);
  }

  async runDueTemplates(context: OrganizationContext, user: PublicUser, metadata: RequestMetadata) {
    const today = isoDate(dateOnly(new Date()));
    const due = await this.prisma.recurringJournalTemplate.findMany({
      where: { organizationId: context.id, active: true, nextRunDate: { lte: today } },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
      orderBy: [{ nextRunDate: 'asc' }],
    });

    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: context.id },
      select: { baseCurrency: true },
    });

    const results: Array<{ templateId: string; journalId: string | null }> = [];

    for (const template of due) {
      const occurrenceDate = dateOnly(template.nextRunDate);
      const claimed = await this.claimOccurrence(context.id, template.id, occurrenceDate);
      if (!claimed) continue;

      const journal = await this.rules.post(
        context,
        user,
        this.generateRule,
        {
          sourceId: template.id,
          journalDate: template.nextRunDate,
          currency: organization.baseCurrency,
          name: template.name,
          occurrenceDate,
          lines: template.lines.map((line) => ({
            accountId: line.accountId,
            description: line.description ?? undefined,
            debitMinor: line.debitMinor,
            creditMinor: line.creditMinor,
          })),
        },
        metadata,
        `${template.id}:${occurrenceDate}`,
      );

      const nextOccurrence = advanceCadence(template.nextRunDate, template.cadence);
      const stillActive = template.endDate ? nextOccurrence <= template.endDate : true;

      await this.prisma.$transaction(async (tx) => {
        await tx.recurringJournalTemplate.update({
          where: { id: template.id },
          data: {
            nextRunDate: nextOccurrence,
            lastRunOccurrenceKey: occurrenceDate,
            active: stillActive,
          },
        });
        await writeAuditEvent(tx, {
          organizationId: context.id,
          actorUserId: user.id,
          eventKey: 'journals.recurring_generated',
          entityType: 'recurring_journal_template',
          entityId: template.id,
          action: AuditAction.UPDATE,
          after: { journalId: journal.id, occurrenceDate },
          ipHash: metadata.ipHash,
        });
      });

      results.push({ templateId: template.id, journalId: journal.id });
    }

    return results;
  }

  private async claimOccurrence(
    organizationId: string,
    templateId: string,
    occurrenceDate: string,
  ): Promise<boolean> {
    const key = `${templateId}:${occurrenceDate}`;
    return this.prisma.$transaction(async (tx) => {
      const lockKey = `${organizationId}:${RECURRING_JOURNAL_CLAIM_OPERATION}:${key}`;
      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text AS locked
      `;
      const existing = await tx.ledgerIdempotencyKey.findUnique({
        where: {
          organizationId_operation_key: {
            organizationId,
            operation: RECURRING_JOURNAL_CLAIM_OPERATION,
            key,
          },
        },
      });
      if (existing) return false;
      await tx.ledgerIdempotencyKey.create({
        data: {
          organizationId,
          operation: RECURRING_JOURNAL_CLAIM_OPERATION,
          key,
          resourceType: 'RECURRING_JOURNAL_TEMPLATE',
          resourceId: templateId,
        },
      });
      return true;
    });
  }

  private async setActive(
    context: OrganizationContext,
    user: PublicUser,
    templateId: string,
    active: boolean,
    metadata: RequestMetadata,
  ) {
    const existing = await this.findOrThrow(context.id, templateId);
    const updated = await this.prisma.$transaction(async (tx) => {
      const template = await tx.recurringJournalTemplate.update({
        where: { id: templateId },
        data: { active },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: active
          ? 'journals.recurring_template_reactivated'
          : 'journals.recurring_template_deactivated',
        entityType: 'recurring_journal_template',
        entityId: templateId,
        action: AuditAction.UPDATE,
        before: { active: existing.active },
        after: { active },
        ipHash: metadata.ipHash,
      });
      return template;
    });
    return summarizeTemplate(updated);
  }

  private async findOrThrow(
    organizationId: string,
    templateId: string,
  ): Promise<TemplateWithLines> {
    const template = await this.prisma.recurringJournalTemplate.findFirst({
      where: { id: templateId, organizationId },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    if (!template) throw new NotFoundException('Recurring journal template not found.');
    return template;
  }

  private async resolveLines(organizationId: string, lines: readonly RecurringJournalLineDto[]) {
    const accountIds = [...new Set(lines.map((line) => line.accountId))];
    const accounts = await this.prisma.ledgerAccount.findMany({
      where: { id: { in: accountIds }, organizationId },
    });
    const accountById = new Map(accounts.map((account) => [account.id, account]));

    return lines.map((line, index) => {
      const label = `Line ${index + 1}`;
      const account = accountById.get(line.accountId);
      if (!account) throw new BadRequestException(`${label}: unknown account.`);
      if (account.status !== LedgerAccountStatus.ACTIVE) {
        throw new BadRequestException(`${label}: account is not active.`);
      }
      const debitMinor = BigInt(line.debitMinor);
      const creditMinor = BigInt(line.creditMinor);
      if (debitMinor < 0n || creditMinor < 0n) {
        throw new BadRequestException(`${label}: negative amounts.`);
      }
      if (debitMinor > 0n && creditMinor > 0n) {
        throw new BadRequestException(`${label}: cannot have both debit and credit.`);
      }
      if (debitMinor === 0n && creditMinor === 0n) {
        throw new BadRequestException(`${label}: needs a debit or credit amount.`);
      }
      return {
        accountId: line.accountId,
        description: line.description,
        debitMinor,
        creditMinor,
      };
    });
  }

  private validateBalanced(lines: readonly { debitMinor: bigint; creditMinor: bigint }[]) {
    let debits = 0n;
    let credits = 0n;
    for (const line of lines) {
      debits += line.debitMinor;
      credits += line.creditMinor;
    }
    if (lines.length < 2) {
      throw new BadRequestException('A recurring journal needs at least two lines.');
    }
    if (debits === 0n || credits === 0n || debits !== credits) {
      throw new BadRequestException('A recurring journal must balance on both sides.');
    }
  }
}

function summarizeTemplate(template: TemplateWithLines) {
  return {
    id: template.id,
    name: template.name,
    memo: template.memo,
    cadence: template.cadence,
    startDate: dateOnly(template.startDate),
    endDate: template.endDate ? dateOnly(template.endDate) : null,
    nextRunDate: dateOnly(template.nextRunDate),
    active: template.active,
    lastRunOccurrenceKey: template.lastRunOccurrenceKey,
    lines: template.lines.map((line) => ({
      id: line.id,
      lineNumber: line.lineNumber,
      accountId: line.accountId,
      debitMinor: line.debitMinor.toString(),
      creditMinor: line.creditMinor.toString(),
      description: line.description,
    })),
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  };
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isoDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}
