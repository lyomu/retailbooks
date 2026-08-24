import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  FiscalPeriodStatus,
  JournalStatus,
  LedgerAccountStatus,
  type Journal,
  type JournalLine,
  type LedgerAccount,
  type Prisma,
} from '@prisma/client';
import { parseExchangeRateToScaled } from '@retailbooks/accounting-core';

import type { PublicUser } from '../auth/auth.service.js';
import type { RequestMetadata } from '../auth/request-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { writeAuditEvent } from './audit-event.js';
import { CurrencyService } from './currency.service.js';
import { DocumentNumberingService } from './document-numbering.service.js';
import {
  AccountLedgerQueryDto,
  CreateAccountDto,
  JournalQueryDto,
  ReversalDto,
  TrialBalanceQueryDto,
  UpdateAccountDto,
  UpsertJournalDto,
} from './ledger.dto.js';
import { starterChartForTemplate, type SystemAccountKey } from './ledger-starter-chart.js';
import { isSupportedCurrency } from './jurisdiction-catalog.js';
import type { OrganizationContext } from './organization-context.js';
import { TaxService } from './tax.service.js';

const POSTED_STATUSES = [JournalStatus.POSTED, JournalStatus.REVERSED] as const;

@Injectable()
export class LedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: DocumentNumberingService,
    private readonly tax: TaxService,
    private readonly currencies: CurrencyService,
  ) {}

  async ensureStarterChart(
    organizationId: string,
    chartTemplate: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<void> {
    const count = await client.ledgerAccount.count({ where: { organizationId } });
    if (count > 0) return;

    await client.ledgerAccount.createMany({
      data: starterChartForTemplate(chartTemplate).map((account) => ({
        organizationId,
        code: account.code,
        name: account.name,
        type: account.type,
        normalBalance: account.normalBalance,
        description: account.description,
        systemSeed: true,
        systemKey: account.systemKey ?? null,
        isControl: account.isControl ?? false,
      })),
      skipDuplicates: true,
    });
  }

  /**
   * Resolves an organization's account for a stable system key.
   *
   * This is the supported way for later modules to reach control accounts. Never match on code or
   * name: codes are editable by the organization, and templates renumber them.
   */
  async accountBySystemKey(
    organizationId: string,
    systemKey: SystemAccountKey,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    await this.ensureStarterChartForOrganization(organizationId, client);
    const account = await client.ledgerAccount.findFirst({
      where: { organizationId, systemKey },
    });
    if (!account) {
      throw new NotFoundException(`No account is bound to the system key "${systemKey}".`);
    }
    return account;
  }

  async listAccounts(organizationId: string) {
    await this.ensureStarterChartForOrganization(organizationId);
    const [accounts, lines] = await Promise.all([
      this.prisma.ledgerAccount.findMany({
        where: { organizationId },
        orderBy: [{ code: 'asc' }],
      }),
      this.prisma.journalLine.findMany({
        where: {
          organizationId,
          journal: { status: { in: [...POSTED_STATUSES] } },
        },
        select: {
          accountId: true,
          debitMinor: true,
          creditMinor: true,
          account: { select: { normalBalance: true } },
        },
      }),
    ]);

    const balances = new Map<string, bigint>();
    for (const line of lines) {
      const movement = signedMovement(
        line.account.normalBalance,
        line.debitMinor,
        line.creditMinor,
      );
      balances.set(line.accountId, (balances.get(line.accountId) ?? 0n) + movement);
    }

    return accounts.map((account) => accountSummary(account, balances.get(account.id) ?? 0n));
  }

  async createAccount(
    context: OrganizationContext,
    user: PublicUser,
    input: CreateAccountDto,
    metadata: RequestMetadata,
  ) {
    const created = await this.prisma.$transaction(async (tx) => {
      const account = await tx.ledgerAccount.create({
        data: { organizationId: context.id, ...input, systemSeed: false },
      });
      await ledgerEvent(tx, user.id, context.id, 'ledger.account_created', metadata, {
        accountId: account.id,
        code: account.code,
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'ledger.account_created',
        entityType: 'ledger_account',
        entityId: account.id,
        action: AuditAction.CREATE,
        after: { code: account.code, name: account.name, type: account.type },
        ipHash: metadata.ipHash,
      });
      return account;
    });

    return accountSummary(created, 0n);
  }

  async updateAccount(
    context: OrganizationContext,
    user: PublicUser,
    accountId: string,
    input: UpdateAccountDto,
    metadata: RequestMetadata,
  ) {
    const existing = await this.prisma.ledgerAccount.findFirst({
      where: { id: accountId, organizationId: context.id },
    });
    if (!existing) throw new NotFoundException('Account not found.');
    if (existing.status === LedgerAccountStatus.ARCHIVED) {
      throw new ConflictException('Archived accounts cannot be edited.');
    }
    const changesSemantics =
      (input.type && input.type !== existing.type) ||
      (input.normalBalance && input.normalBalance !== existing.normalBalance);
    if (changesSemantics && existing.systemKey) {
      throw new ConflictException(
        'System accounts cannot change type or normal balance; other modules depend on their meaning.',
      );
    }
    if (changesSemantics && (await this.hasPostedAccountHistory(context.id, accountId))) {
      throw new ConflictException(
        'Accounts with posted history cannot change type or normal balance.',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const account = await tx.ledgerAccount.update({
        where: { id: accountId },
        data: input,
      });
      await ledgerEvent(tx, user.id, context.id, 'ledger.account_updated', metadata, {
        accountId,
        before: {
          code: existing.code,
          name: existing.name,
          type: existing.type,
          normalBalance: existing.normalBalance,
        },
        after: {
          code: input.code ?? null,
          name: input.name ?? null,
          type: input.type ?? null,
          normalBalance: input.normalBalance ?? null,
          description: input.description ?? null,
        },
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'ledger.account_updated',
        entityType: 'ledger_account',
        entityId: accountId,
        action: AuditAction.UPDATE,
        before: {
          code: existing.code,
          name: existing.name,
          type: existing.type,
          normalBalance: existing.normalBalance,
          description: existing.description,
        },
        after: {
          code: account.code,
          name: account.name,
          type: account.type,
          normalBalance: account.normalBalance,
          description: account.description,
        },
        ipHash: metadata.ipHash,
      });
      return account;
    });

    return accountSummary(updated, await this.accountBalance(context.id, updated.id));
  }

  async archiveAccount(
    context: OrganizationContext,
    user: PublicUser,
    accountId: string,
    metadata: RequestMetadata,
  ) {
    const existing = await this.prisma.ledgerAccount.findFirst({
      where: { id: accountId, organizationId: context.id },
    });
    if (!existing) throw new NotFoundException('Account not found.');
    if (existing.systemKey || existing.isControl) {
      throw new ConflictException(
        'System and control accounts cannot be archived while the organization exists.',
      );
    }
    if (existing.status === LedgerAccountStatus.ARCHIVED) return;

    await this.prisma.$transaction(async (tx) => {
      await tx.ledgerAccount.update({
        where: { id: accountId },
        data: { status: LedgerAccountStatus.ARCHIVED, archivedAt: new Date() },
      });
      await ledgerEvent(tx, user.id, context.id, 'ledger.account_archived', metadata, {
        accountId,
        code: existing.code,
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'ledger.account_archived',
        entityType: 'ledger_account',
        entityId: accountId,
        action: AuditAction.UPDATE,
        before: { status: existing.status },
        after: { status: LedgerAccountStatus.ARCHIVED },
        ipHash: metadata.ipHash,
      });
    });
  }

  async listJournals(organizationId: string, query: JournalQueryDto) {
    const status = isJournalStatus(query.status) ? query.status : undefined;
    const journals = await this.prisma.journal.findMany({
      where: { organizationId, ...(status ? { status } : {}) },
      orderBy: [{ journalDate: 'desc' }, { createdAt: 'desc' }],
      include: { lines: true },
      take: 100,
    });
    return journals.map(journalSummary);
  }

  async createJournalDraft(
    context: OrganizationContext,
    user: PublicUser,
    input: UpsertJournalDto,
  ) {
    const organization = await this.organizationForLedger(context.id);
    await this.validateJournalInput(context.id, organization.baseCurrency, input);

    const journal = await this.prisma.journal.create({
      data: {
        organizationId: context.id,
        journalDate: isoDate(input.journalDate),
        currency: input.currency,
        exchangeRate: input.exchangeRate,
        description: input.description,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        createdByUserId: user.id,
        lines: { create: lineCreates(context.id, input.lines) },
      },
      include: journalDetailInclude,
    });

    return journalDetail(journal);
  }

  async getJournal(organizationId: string, journalId: string) {
    const journal = await this.prisma.journal.findFirst({
      where: { id: journalId, organizationId },
      include: journalDetailInclude,
    });
    if (!journal) throw new NotFoundException('Journal not found.');
    return journalDetail(journal);
  }

  async updateJournalDraft(
    context: OrganizationContext,
    journalId: string,
    input: UpsertJournalDto,
  ) {
    const organization = await this.organizationForLedger(context.id);
    const existing = await this.prisma.journal.findFirst({
      where: { id: journalId, organizationId: context.id },
      select: { id: true, status: true },
    });
    if (!existing) throw new NotFoundException('Journal not found.');
    if (existing.status !== JournalStatus.DRAFT) {
      throw new ConflictException('Posted journals cannot be edited.');
    }

    await this.validateJournalInput(context.id, organization.baseCurrency, input);
    const journal = await this.prisma.$transaction(async (tx) => {
      await tx.journalLine.deleteMany({ where: { journalId } });
      return tx.journal.update({
        where: { id: journalId },
        data: {
          journalDate: isoDate(input.journalDate),
          currency: input.currency,
          exchangeRate: input.exchangeRate,
          description: input.description,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          lines: { create: lineCreates(context.id, input.lines) },
        },
        include: journalDetailInclude,
      });
    });

    return journalDetail(journal);
  }

  async deleteJournalDraft(organizationId: string, journalId: string) {
    const existing = await this.prisma.journal.findFirst({
      where: { id: journalId, organizationId },
      select: { id: true, status: true },
    });
    if (!existing) throw new NotFoundException('Journal not found.');
    if (existing.status !== JournalStatus.DRAFT) {
      throw new ConflictException('Posted journals cannot be deleted.');
    }
    await this.prisma.journal.delete({ where: { id: journalId } });
  }

  async postJournal(
    context: OrganizationContext,
    user: PublicUser,
    journalId: string,
    metadata: RequestMetadata,
    idempotencyKey?: string,
  ) {
    const posted = await this.prisma.$transaction(async (tx) => {
      await this.lockIdempotency(tx, context.id, 'JOURNAL_POST', idempotencyKey);
      const existing = await this.findIdempotentResult(
        context.id,
        'JOURNAL_POST',
        idempotencyKey,
        tx,
      );
      if (existing) {
        return tx.journal.findFirstOrThrow({
          where: { id: existing.resourceId, organizationId: context.id },
          include: journalDetailInclude,
        });
      }

      await this.lockJournal(tx, context.id, journalId);
      const journal = await tx.journal.findFirst({
        where: { id: journalId, organizationId: context.id },
        include: journalDetailInclude,
      });
      if (!journal) throw new NotFoundException('Journal not found.');
      if (journal.status !== JournalStatus.DRAFT) {
        throw new ConflictException('Only draft journals can be posted.');
      }

      const preparedJournal = await this.prepareFxPosting(tx, context.id, journal);
      await this.validatePostingState(tx, context.id, preparedJournal);
      const allocation = await this.numbering.allocateJournalNumberWithClient(
        tx,
        context.id,
        preparedJournal.journalDate,
      );
      const postedJournal = await tx.journal.update({
        where: { id: preparedJournal.id },
        data: {
          reference: allocation.value,
          status: JournalStatus.POSTED,
          postedAt: new Date(),
          postedByUserId: user.id,
        },
        include: journalDetailInclude,
      });

      await this.tax.freezeLineSnapshots(
        tx,
        context.id,
        dateOnly(postedJournal.journalDate),
        postedJournal.lines.map((line) => ({
          id: line.id,
          taxCodeId: line.taxCodeId,
          debitMinor: line.debitMinor,
          creditMinor: line.creditMinor,
        })),
      );

      await this.recordIdempotency(
        tx,
        context.id,
        'JOURNAL_POST',
        idempotencyKey,
        postedJournal.id,
      );
      await ledgerEvent(tx, user.id, context.id, 'ledger.journal_posted', metadata, {
        journalId: postedJournal.id,
        reference: allocation.value,
        debitMinor: sum(postedJournal.lines.map((line) => line.debitMinor)).toString(),
        creditMinor: sum(postedJournal.lines.map((line) => line.creditMinor)).toString(),
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'ledger.journal_posted',
        entityType: 'journal',
        entityId: postedJournal.id,
        action: AuditAction.UPDATE,
        before: { status: JournalStatus.DRAFT },
        after: {
          status: JournalStatus.POSTED,
          reference: allocation.value,
          currency: postedJournal.currency,
          exchangeRate: postedJournal.exchangeRate?.toString() ?? null,
        },
        ipHash: metadata.ipHash,
      });

      const finalJournal = await tx.journal.findFirst({
        where: { id: postedJournal.id },
        include: journalDetailInclude,
      });
      return finalJournal!;
    });

    return journalDetail(posted);
  }

  async reverseJournal(
    context: OrganizationContext,
    user: PublicUser,
    journalId: string,
    input: ReversalDto,
    metadata: RequestMetadata,
    idempotencyKey?: string,
  ) {
    const key = input.idempotencyKey ?? idempotencyKey;
    const reversal = await this.prisma.$transaction(async (tx) => {
      await this.lockIdempotency(tx, context.id, 'JOURNAL_REVERSE', key);
      const existing = await this.findIdempotentResult(context.id, 'JOURNAL_REVERSE', key, tx);
      if (existing) {
        return tx.journal.findFirstOrThrow({
          where: { id: existing.resourceId, organizationId: context.id },
          include: journalDetailInclude,
        });
      }

      await this.lockJournal(tx, context.id, journalId);
      const original = await tx.journal.findFirst({
        where: { id: journalId, organizationId: context.id },
        include: journalDetailInclude,
      });
      if (!original) throw new NotFoundException('Journal not found.');
      if (original.status !== JournalStatus.POSTED) {
        throw new ConflictException('Only posted journals can be reversed once.');
      }
      if (original.reversalJournal) {
        throw new ConflictException('This journal has already been reversed.');
      }

      const reversalDate = input.journalDate ?? dateOnly(new Date());
      await this.requireOpenPeriod(tx, context.id, reversalDate);
      const allocation = await this.numbering.allocateJournalNumberWithClient(
        tx,
        context.id,
        new Date(`${reversalDate}T00:00:00.000Z`),
      );

      const created = await tx.journal.create({
        data: {
          organizationId: context.id,
          reference: allocation.value,
          status: JournalStatus.POSTED,
          journalDate: isoDate(reversalDate),
          currency: original.currency,
          exchangeRate: original.exchangeRate,
          description: input.description ?? `Reversal of ${original.reference ?? original.id}`,
          sourceType: 'REVERSAL',
          sourceId: original.id,
          createdByUserId: user.id,
          postedAt: new Date(),
          postedByUserId: user.id,
          reversalOfJournalId: original.id,
          lines: {
            create: original.lines.map((line, index) => ({
              organizationId: context.id,
              accountId: line.accountId,
              lineNumber: index + 1,
              description: line.description,
              debitMinor: line.creditMinor,
              creditMinor: line.debitMinor,
              foreignAmountMinor: line.foreignAmountMinor,
              exchangeRate: line.exchangeRate,
              taxCodeId: line.taxCodeId,
              taxCodeSnapshot: line.taxCodeSnapshot,
              taxTreatmentSnapshot: line.taxTreatmentSnapshot,
              taxRecoverableSnapshot: line.taxRecoverableSnapshot,
              taxRatePercentSnapshot: line.taxRatePercentSnapshot,
              taxableAmountMinor: line.taxableAmountMinor,
              taxAmountMinor: line.taxAmountMinor,
            })),
          },
        },
        include: journalDetailInclude,
      });

      await tx.journal.update({
        where: { id: original.id },
        data: { status: JournalStatus.REVERSED },
      });

      await this.recordIdempotency(tx, context.id, 'JOURNAL_REVERSE', key, created.id);
      await ledgerEvent(tx, user.id, context.id, 'ledger.journal_reversed', metadata, {
        originalJournalId: original.id,
        reversalJournalId: created.id,
        originalReference: original.reference,
        reversalReference: created.reference,
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'ledger.journal_reversed',
        entityType: 'journal',
        entityId: original.id,
        action: AuditAction.UPDATE,
        before: { status: JournalStatus.POSTED },
        after: {
          status: JournalStatus.REVERSED,
          reversalJournalId: created.id,
          reversalReference: created.reference,
        },
        ipHash: metadata.ipHash,
      });
      return created;
    });

    return journalDetail(reversal);
  }

  async trialBalance(organizationId: string, query: TrialBalanceQueryDto) {
    const asOf = query.asOf ?? dateOnly(new Date());
    const accounts = await this.prisma.ledgerAccount.findMany({
      where: { organizationId },
      orderBy: [{ code: 'asc' }],
    });
    const lines = await this.prisma.journalLine.findMany({
      where: {
        organizationId,
        journal: { status: { in: [...POSTED_STATUSES] }, journalDate: { lte: isoDate(asOf) } },
      },
      include: { account: true },
    });

    const movementByAccount = movementMap(lines);
    const rows = accounts.map((account) => {
      const movementMinor = movementByAccount.get(account.id) ?? 0n;
      const sides = trialSides(account.normalBalance, movementMinor);
      return {
        accountId: account.id,
        accountCode: account.code,
        accountName: account.name,
        accountType: account.type,
        normalBalance: account.normalBalance,
        debitMinor: sides.debitMinor.toString(),
        creditMinor: sides.creditMinor.toString(),
      };
    });
    const debitTotal = sum(rows.map((row) => BigInt(row.debitMinor)));
    const creditTotal = sum(rows.map((row) => BigInt(row.creditMinor)));

    return {
      asOf,
      rows,
      totals: {
        debitMinor: debitTotal.toString(),
        creditMinor: creditTotal.toString(),
        balanced: debitTotal === creditTotal,
      },
    };
  }

  async accountLedger(organizationId: string, accountId: string, query: AccountLedgerQueryDto) {
    const account = await this.prisma.ledgerAccount.findFirst({
      where: { id: accountId, organizationId },
    });
    if (!account) throw new NotFoundException('Account not found.');

    const from = query.from;
    const to = query.to ?? dateOnly(new Date());
    const openingLines = from
      ? await this.prisma.journalLine.findMany({
          where: {
            organizationId,
            accountId,
            journal: { status: { in: [...POSTED_STATUSES] }, journalDate: { lt: isoDate(from) } },
          },
          include: { journal: true },
        })
      : [];
    const openingBalanceMinor = sum(
      openingLines.map((line) =>
        signedMovement(account.normalBalance, line.debitMinor, line.creditMinor),
      ),
    );

    const lines = await this.prisma.journalLine.findMany({
      where: {
        organizationId,
        accountId,
        journal: {
          status: { in: [...POSTED_STATUSES] },
          journalDate: { ...(from ? { gte: isoDate(from) } : {}), lte: isoDate(to) },
        },
      },
      include: { journal: true },
      orderBy: [{ journal: { journalDate: 'asc' } }, { lineNumber: 'asc' }],
      take: query.limit ?? 100,
    });

    let running = openingBalanceMinor;
    const rows = lines.map((line) => {
      running += signedMovement(account.normalBalance, line.debitMinor, line.creditMinor);
      return {
        id: line.id,
        journalId: line.journalId,
        reference: line.journal.reference,
        journalDate: dateOnly(line.journal.journalDate),
        description: line.description ?? line.journal.description,
        debitMinor: line.debitMinor.toString(),
        creditMinor: line.creditMinor.toString(),
        balanceMinor: running.toString(),
      };
    });

    return {
      account: accountSummary(account, running),
      from: from ?? null,
      to,
      openingBalanceMinor: openingBalanceMinor.toString(),
      closingBalanceMinor: running.toString(),
      rows,
    };
  }

  private async ensureStarterChartForOrganization(
    organizationId: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const organization = await client.organization.findUnique({
      where: { id: organizationId },
      select: { preferences: { select: { chartTemplate: true } } },
    });
    if (!organization?.preferences) throw new NotFoundException('Organization not found.');
    await this.ensureStarterChart(organizationId, organization.preferences.chartTemplate, client);
  }

  private async organizationForLedger(organizationId: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { baseCurrency: true },
    });
    if (!organization) throw new NotFoundException('Organization not found.');
    return organization;
  }

  private async validateJournalInput(
    organizationId: string,
    baseCurrency: string,
    input: UpsertJournalDto,
  ) {
    if (!isSupportedCurrency(input.currency)) {
      throw new BadRequestException('That journal currency is not available.');
    }
    const foreignJournal = input.currency !== baseCurrency;
    const hasForeignAmounts = input.lines.some((line) => line.foreignAmountMinor !== undefined);
    if (!foreignJournal && (input.exchangeRate !== undefined || hasForeignAmounts)) {
      throw new BadRequestException('Base-currency journals cannot carry foreign-currency values.');
    }
    if (foreignJournal) {
      const enabled = await this.prisma.organizationCurrency.findUnique({
        where: {
          organizationId_currencyCode: {
            organizationId,
            currencyCode: input.currency,
          },
        },
      });
      if (!enabled?.enabled) {
        throw new BadRequestException('Enable the journal currency before using it.');
      }
      if (!hasForeignAmounts) {
        throw new BadRequestException('A foreign-currency journal needs a foreign amount.');
      }
      if (input.exchangeRate !== undefined) parseExchangeRateToScaled(input.exchangeRate);
    }
    const lines = parsedLines(input.lines);
    const lineErrors = validateLines(lines, !foreignJournal);
    if (lineErrors.length > 0) throw new BadRequestException({ message: lineErrors });

    const accountIds = Array.from(new Set(input.lines.map((line) => line.accountId)));
    const accounts = await this.prisma.ledgerAccount.findMany({
      where: {
        organizationId,
        id: { in: accountIds },
        status: LedgerAccountStatus.ACTIVE,
      },
      select: { id: true },
    });
    if (accounts.length !== accountIds.length) {
      throw new BadRequestException('Every journal line must use an active account.');
    }
  }

  private async validatePostingState(
    tx: Prisma.TransactionClient,
    organizationId: string,
    journal: JournalWithDetail,
  ) {
    await this.requireOpenPeriod(tx, organizationId, dateOnly(journal.journalDate));
    const lines = journal.lines.map((line) => ({
      accountId: line.accountId,
      debitMinor: line.debitMinor,
      creditMinor: line.creditMinor,
    }));
    const errors = validateLines(lines);
    if (errors.length > 0) throw new BadRequestException({ message: errors });

    const inactive = journal.lines.find(
      (line) => line.account.status !== LedgerAccountStatus.ACTIVE,
    );
    if (inactive) throw new BadRequestException('Every journal line must use an active account.');
  }

  private async prepareFxPosting(
    tx: Prisma.TransactionClient,
    organizationId: string,
    journal: JournalWithDetail,
  ): Promise<JournalWithDetail> {
    const organization = await tx.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { baseCurrency: true },
    });
    if (journal.currency === organization.baseCurrency) return journal;

    const resolved = await this.currencies.resolveRate(
      tx,
      organizationId,
      organization.baseCurrency,
      journal.currency,
      journal.journalDate,
      journal.exchangeRate?.toString(),
    );

    await tx.journal.update({
      where: { id: journal.id },
      data: { exchangeRate: resolved.rate },
    });
    for (const line of journal.lines) {
      const foreignAmount = line.foreignAmountMinor;
      const side = line.debitMinor > 0n ? 'DEBIT' : line.creditMinor > 0n ? 'CREDIT' : null;
      if (foreignAmount !== null && foreignAmount <= 0n) {
        throw new BadRequestException('Foreign amounts must be greater than zero.');
      }
      const converted =
        foreignAmount === null
          ? null
          : this.currencies.convert({
              foreignAmountMinor: foreignAmount,
              exchangeRate: resolved.rate,
              base: resolved.base,
              quote: resolved.quote,
            });
      await tx.journalLine.update({
        where: { id: line.id },
        data: {
          exchangeRate: resolved.rate,
          ...(converted !== null && side === 'DEBIT'
            ? { debitMinor: converted, creditMinor: 0n }
            : {}),
          ...(converted !== null && side === 'CREDIT'
            ? { debitMinor: 0n, creditMinor: converted }
            : {}),
        },
      });
    }

    let prepared = await tx.journal.findFirstOrThrow({
      where: { id: journal.id, organizationId },
      include: journalDetailInclude,
    });
    const totals = journalTotals(prepared.lines);
    if (totals.debitMinor !== totals.creditMinor) {
      if (prepared.lines.length >= 200) {
        throw new BadRequestException('The journal has no room for its FX balancing line.');
      }
      const debitShort = totals.debitMinor < totals.creditMinor;
      const account = await this.accountBySystemKey(
        organizationId,
        debitShort ? 'fx_loss' : 'fx_gain',
        tx,
      );
      const difference = debitShort
        ? totals.creditMinor - totals.debitMinor
        : totals.debitMinor - totals.creditMinor;
      await tx.journalLine.create({
        data: {
          organizationId,
          journalId: journal.id,
          accountId: account.id,
          lineNumber: Math.max(...prepared.lines.map((line) => line.lineNumber)) + 1,
          description: debitShort ? 'Foreign exchange loss' : 'Foreign exchange gain',
          debitMinor: debitShort ? difference : 0n,
          creditMinor: debitShort ? 0n : difference,
          exchangeRate: resolved.rate,
        },
      });
      prepared = await tx.journal.findFirstOrThrow({
        where: { id: journal.id, organizationId },
        include: journalDetailInclude,
      });
    }

    return prepared;
  }

  private async requireOpenPeriod(
    tx: Prisma.TransactionClient,
    organizationId: string,
    journalDate: string,
  ) {
    const period = await tx.fiscalPeriod.findFirst({
      where: {
        organizationId,
        startsOn: { lte: isoDate(journalDate) },
        endsOn: { gte: isoDate(journalDate) },
      },
      select: { id: true, status: true, code: true },
    });
    if (!period)
      throw new BadRequestException('Create a fiscal period for this journal date first.');
    if (period.status !== FiscalPeriodStatus.OPEN) {
      throw new ConflictException(`Fiscal period ${period.code} is not open.`);
    }
  }

  private async accountBalance(organizationId: string, accountId: string): Promise<bigint> {
    const lines = await this.prisma.journalLine.findMany({
      where: {
        organizationId,
        accountId,
        journal: { status: { in: [...POSTED_STATUSES] } },
      },
      include: { account: true },
    });
    return sum(
      lines.map((line) =>
        signedMovement(line.account.normalBalance, line.debitMinor, line.creditMinor),
      ),
    );
  }

  private async hasPostedAccountHistory(
    organizationId: string,
    accountId: string,
  ): Promise<boolean> {
    const count = await this.prisma.journalLine.count({
      where: {
        organizationId,
        accountId,
        journal: { status: { in: [...POSTED_STATUSES] } },
      },
    });
    return count > 0;
  }

  private async findIdempotentResult(
    organizationId: string,
    operation: string,
    key?: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<{ resourceId: string } | null> {
    if (!key) return null;
    return client.ledgerIdempotencyKey.findUnique({
      where: { organizationId_operation_key: { organizationId, operation, key } },
      select: { resourceId: true },
    });
  }

  /**
   * Serializes the check-and-record sequence for one idempotency key. PostgreSQL releases this lock
   * automatically with the transaction, including on rollback, so no cleanup row or expiry policy
   * is needed. Hash collisions only serialize unrelated requests; they cannot corrupt results.
   */
  private async lockIdempotency(
    tx: Prisma.TransactionClient,
    organizationId: string,
    operation: string,
    key?: string,
  ): Promise<void> {
    if (!key) return;
    const lockKey = `${organizationId}:${operation}:${key}`;
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text AS locked
    `;
  }

  /** Prevents two different idempotency keys from acting on the same journal concurrently. */
  private async lockJournal(
    tx: Prisma.TransactionClient,
    organizationId: string,
    journalId: string,
  ): Promise<void> {
    await tx.$queryRaw`
      SELECT id
      FROM journals
      WHERE id = ${journalId}::uuid AND organization_id = ${organizationId}::uuid
      FOR UPDATE
    `;
  }

  private recordIdempotency(
    tx: Prisma.TransactionClient,
    organizationId: string,
    operation: string,
    key: string | undefined,
    resourceId: string,
  ) {
    if (!key) return undefined;
    return tx.ledgerIdempotencyKey.create({
      data: { organizationId, operation, key, resourceType: 'JOURNAL', resourceId },
    });
  }
}

const journalDetailInclude = {
  lines: { orderBy: { lineNumber: 'asc' }, include: { account: true } },
  createdBy: { select: { displayName: true } },
  postedBy: { select: { displayName: true } },
  reversalOf: { select: { id: true, reference: true } },
  reversalJournal: { select: { id: true, reference: true } },
} satisfies Prisma.JournalInclude;

type JournalWithDetail = Prisma.JournalGetPayload<{ include: typeof journalDetailInclude }>;

function parsedLines(
  lines: readonly {
    accountId: string;
    debitMinor: string;
    creditMinor: string;
    foreignAmountMinor?: string;
  }[],
) {
  return lines.map((line) => ({
    accountId: line.accountId,
    debitMinor: BigInt(line.debitMinor),
    creditMinor: BigInt(line.creditMinor),
    foreignAmountMinor:
      line.foreignAmountMinor === undefined ? null : BigInt(line.foreignAmountMinor),
  }));
}

function validateLines(
  lines: readonly {
    accountId: string;
    debitMinor: bigint;
    creditMinor: bigint;
    foreignAmountMinor?: bigint | null;
  }[],
  requireBalanced = true,
) {
  const errors: string[] = [];
  if (lines.length < 2) errors.push('A journal needs at least two lines.');
  for (const [index, line] of lines.entries()) {
    const label = `Line ${index + 1}`;
    if (!line.accountId) errors.push(`${label} needs an account.`);
    if (line.debitMinor < 0n || line.creditMinor < 0n) {
      errors.push(`${label} cannot have negative amounts.`);
    }
    if (line.debitMinor === 0n && line.creditMinor === 0n) {
      errors.push(`${label} needs a debit or credit amount.`);
    }
    if (line.debitMinor > 0n && line.creditMinor > 0n) {
      errors.push(`${label} cannot have both debit and credit.`);
    }
    if (line.foreignAmountMinor !== undefined && line.foreignAmountMinor !== null) {
      if (line.foreignAmountMinor <= 0n) {
        errors.push(`${label} foreign amount must be greater than zero.`);
      }
    }
  }
  const debitMinor = sum(lines.map((line) => line.debitMinor));
  const creditMinor = sum(lines.map((line) => line.creditMinor));
  if (debitMinor <= 0n || creditMinor <= 0n)
    errors.push('Journal totals must be greater than zero.');
  if (requireBalanced && debitMinor !== creditMinor) {
    errors.push('Journal debits and credits must balance.');
  }
  return [...new Set(errors)];
}

function lineCreates(
  organizationId: string,
  lines: readonly {
    accountId: string;
    description?: string;
    debitMinor: string;
    creditMinor: string;
    taxCodeId?: string;
    foreignAmountMinor?: string;
  }[],
) {
  return lines.map((line, index) => ({
    organizationId,
    accountId: line.accountId,
    lineNumber: index + 1,
    description: line.description,
    debitMinor: BigInt(line.debitMinor),
    creditMinor: BigInt(line.creditMinor),
    foreignAmountMinor:
      line.foreignAmountMinor === undefined ? null : BigInt(line.foreignAmountMinor),
    taxCodeId: line.taxCodeId,
  }));
}

function accountSummary(account: LedgerAccount, balanceMinor: bigint) {
  return {
    id: account.id,
    code: account.code,
    name: account.name,
    type: account.type,
    normalBalance: account.normalBalance,
    status: account.status,
    description: account.description,
    systemSeed: account.systemSeed,
    systemKey: account.systemKey,
    isControl: account.isControl,
    balanceMinor: balanceMinor.toString(),
  };
}

function journalSummary(journal: Journal & { lines: JournalLine[] }) {
  const totals = journalTotals(journal.lines);
  return {
    id: journal.id,
    reference: journal.reference,
    status: journal.status,
    journalDate: dateOnly(journal.journalDate),
    currency: journal.currency,
    exchangeRate: journal.exchangeRate?.toString() ?? null,
    description: journal.description,
    debitMinor: totals.debitMinor.toString(),
    creditMinor: totals.creditMinor.toString(),
    lineCount: journal.lines.length,
    postedAt: journal.postedAt?.toISOString() ?? null,
    createdAt: journal.createdAt.toISOString(),
  };
}

function journalDetail(journal: JournalWithDetail) {
  const totals = journalTotals(journal.lines);
  return {
    ...journalSummary(journal),
    sourceType: journal.sourceType,
    sourceId: journal.sourceId,
    createdBy: journal.createdBy.displayName,
    postedBy: journal.postedBy?.displayName ?? null,
    reversalOf: journal.reversalOf,
    reversalJournal: journal.reversalJournal,
    lines: journal.lines.map((line) => ({
      id: line.id,
      accountId: line.accountId,
      accountCode: line.account.code,
      accountName: line.account.name,
      lineNumber: line.lineNumber,
      description: line.description,
      debitMinor: line.debitMinor.toString(),
      creditMinor: line.creditMinor.toString(),
      foreignAmountMinor:
        line.foreignAmountMinor !== null ? line.foreignAmountMinor.toString() : null,
      exchangeRate: line.exchangeRate?.toString() ?? null,
      taxCodeId: line.taxCodeId,
      taxCodeSnapshot: line.taxCodeSnapshot,
      taxTreatmentSnapshot: line.taxTreatmentSnapshot,
      taxRecoverableSnapshot: line.taxRecoverableSnapshot,
      taxRatePercentSnapshot: line.taxRatePercentSnapshot
        ? line.taxRatePercentSnapshot.toString()
        : null,
      taxableAmountMinor:
        line.taxableAmountMinor !== null ? line.taxableAmountMinor.toString() : null,
      taxAmountMinor: line.taxAmountMinor !== null ? line.taxAmountMinor.toString() : null,
    })),
    totals: {
      debitMinor: totals.debitMinor.toString(),
      creditMinor: totals.creditMinor.toString(),
      balanced: totals.debitMinor === totals.creditMinor,
    },
  };
}

function journalTotals(lines: readonly Pick<JournalLine, 'debitMinor' | 'creditMinor'>[]) {
  return {
    debitMinor: sum(lines.map((line) => line.debitMinor)),
    creditMinor: sum(lines.map((line) => line.creditMinor)),
  };
}

function movementMap(lines: readonly (JournalLine & { account: LedgerAccount })[]) {
  const result = new Map<string, bigint>();
  for (const line of lines) {
    result.set(
      line.accountId,
      (result.get(line.accountId) ?? 0n) +
        signedMovement(line.account.normalBalance, line.debitMinor, line.creditMinor),
    );
  }
  return result;
}

function signedMovement(
  normalBalance: 'DEBIT' | 'CREDIT',
  debitMinor: bigint,
  creditMinor: bigint,
) {
  return normalBalance === 'DEBIT' ? debitMinor - creditMinor : creditMinor - debitMinor;
}

function trialSides(normalBalance: 'DEBIT' | 'CREDIT', movementMinor: bigint) {
  const absolute = movementMinor < 0n ? -movementMinor : movementMinor;
  const onNormalSide = movementMinor >= 0n;
  return {
    debitMinor:
      normalBalance === 'DEBIT' ? (onNormalSide ? absolute : 0n) : onNormalSide ? 0n : absolute,
    creditMinor:
      normalBalance === 'CREDIT' ? (onNormalSide ? absolute : 0n) : onNormalSide ? 0n : absolute,
  };
}

function sum(values: readonly bigint[]): bigint {
  return values.reduce((total, value) => total + value, 0n);
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isoDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}

function ledgerEvent(
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

function isJournalStatus(value: string | undefined): value is JournalStatus {
  return Object.values(JournalStatus).includes(value as JournalStatus);
}
