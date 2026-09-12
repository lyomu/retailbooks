import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, type Prisma } from '@prisma/client';
import { roundHalfUpDivide } from '@retailbooks/accounting-core';

import type { PublicUser } from '../auth/auth.service.js';
import type { RequestMetadata } from '../auth/request-context.js';
import { assertNoPendingApproval } from '../automation/approval-targets.js';
import { PrismaService } from '../database/prisma.service.js';
import { EMAIL_JOB_NAMES } from '../jobs/email-job.js';
import { EmailQueueService } from '../jobs/email-queue.service.js';
import { writeAuditEvent } from '../organizations/audit-event.js';
import { CREDIT_NOTE_DOCUMENT_TYPE } from '../organizations/document-numbering.js';
import { DocumentNumberingService } from '../organizations/document-numbering.service.js';
import { LedgerService } from '../organizations/ledger.service.js';
import type { OrganizationContext } from '../organizations/organization-context.js';
import { TaxService } from '../organizations/tax.service.js';
import type {
  AllocateCreditNoteDto,
  CreateCreditNoteDto,
  CreditNoteLineDto,
  RefundCreditNoteDto,
  UpdateCreditNoteDto,
} from './credit-notes.dto.js';
import { DocumentRenderingService } from './document-rendering.service.js';
import { buildPdfRenderSnapshot, parsePdfRenderSnapshot } from './pdf-render-snapshot.js';
import { renderCreditNoteHtml } from './pdf-templates.js';

const QUANTITY_SCALE = 10_000n;
const OPEN_INVOICE_STATUSES = ['ISSUED', 'PARTIALLY_PAID'] as const;

type CreditNoteWithDetail = Prisma.CreditNoteGetPayload<{
  include: typeof creditNoteDetailInclude;
}>;

const creditNoteDetailInclude = {
  lines: { orderBy: { lineNumber: 'asc' } },
  contact: {
    select: { id: true, displayName: true, currency: true, receivableAccountId: true, email: true },
  },
  allocations: {
    include: { invoice: { select: { id: true, invoiceNumber: true } } },
    orderBy: { createdAt: 'asc' },
  },
  refunds: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.CreditNoteInclude;

/**
 * Credit Notes issue into the `customer_credit` liability account, not directly into
 * `accounts_receivable` -- the checklist's "issue posts... credit AR" is satisfied one step later,
 * when the credit is *allocated* to a specific invoice (`DR customer_credit, CR
 * accounts_receivable`). This is the only way both "issue credits something" and "a customer_credit
 * account exists for the refund path" can be true at once: a credit note's value has nowhere real to
 * land at issue time until it's resolved either by allocation or by refund (`DR customer_credit, CR
 * bank_default`). Unlike `PaymentsService#allocate`, allocation here is a real posting each time, not
 * bookkeeping against value that already landed in a real account.
 */
@Injectable()
export class CreditNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly tax: TaxService,
    private readonly numbering: DocumentNumberingService,
    private readonly documentRendering: DocumentRenderingService,
    private readonly emailQueue: EmailQueueService,
  ) {}

  async list(organizationId: string, status?: string) {
    const creditNotes = await this.prisma.creditNote.findMany({
      where: { organizationId, ...(status ? { status: status as never } : {}) },
      orderBy: [{ createdAt: 'desc' }],
      include: creditNoteDetailInclude,
      take: 200,
    });
    return creditNotes.map(summarizeCreditNote);
  }

  async detail(organizationId: string, creditNoteId: string) {
    const creditNote = await this.findOrThrow(organizationId, creditNoteId);
    return summarizeCreditNote(creditNote);
  }

  async createDraft(
    context: OrganizationContext,
    user: PublicUser,
    input: CreateCreditNoteDto,
    metadata: RequestMetadata,
  ) {
    const contact = await this.prisma.contact.findFirst({
      where: { id: input.contactId, organizationId: context.id, type: 'CUSTOMER' },
    });
    if (!contact) throw new NotFoundException('Customer not found.');
    if (contact.status !== 'ACTIVE') {
      throw new ConflictException('Cannot credit a deactivated customer.');
    }
    const currency = input.currency ?? contact.currency;
    const resolvedLines = await this.resolveLines(context, currency, input.lines);
    const totals = lineTotals(resolvedLines);

    const created = await this.prisma.$transaction(async (tx) => {
      const creditNote = await tx.creditNote.create({
        data: {
          organizationId: context.id,
          contactId: contact.id,
          currency,
          subtotalMinor: totals.subtotalMinor,
          taxTotalMinor: totals.taxTotalMinor,
          totalMinor: totals.totalMinor,
          remainingMinor: 0n,
          createdByUserId: user.id,
          lines: {
            create: resolvedLines.map((line, index) => lineCreateData(line, index, context.id)),
          },
        },
        include: creditNoteDetailInclude,
      });

      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'sales.credit_note_created',
        entityType: 'credit_note',
        entityId: creditNote.id,
        action: AuditAction.CREATE,
        after: { contactId: contact.id, totalMinor: totals.totalMinor.toString() },
        ipHash: metadata.ipHash,
      });

      return creditNote;
    });

    return summarizeCreditNote(created);
  }

  async updateDraft(
    context: OrganizationContext,
    user: PublicUser,
    creditNoteId: string,
    input: UpdateCreditNoteDto,
    metadata: RequestMetadata,
  ) {
    const existing = await this.findOrThrow(context.id, creditNoteId);
    if (existing.status !== 'DRAFT') {
      throw new ConflictException('Only draft credit notes can be edited.');
    }

    let contact = existing.contact;
    if (input.contactId && input.contactId !== existing.contactId) {
      const nextContact = await this.prisma.contact.findFirst({
        where: { id: input.contactId, organizationId: context.id, type: 'CUSTOMER' },
      });
      if (!nextContact) throw new NotFoundException('Customer not found.');
      if (nextContact.status !== 'ACTIVE') {
        throw new ConflictException('Cannot credit a deactivated customer.');
      }
      contact = {
        id: nextContact.id,
        displayName: nextContact.displayName,
        currency: nextContact.currency,
        receivableAccountId: nextContact.receivableAccountId,
        email: nextContact.email,
      };
    }

    const currency = input.currency ?? contact.currency;
    const resolvedLines = input.lines
      ? await this.resolveLines(context, currency, input.lines)
      : null;
    const totals = resolvedLines
      ? lineTotals(resolvedLines)
      : {
          subtotalMinor: existing.subtotalMinor,
          taxTotalMinor: existing.taxTotalMinor,
          totalMinor: existing.totalMinor,
        };

    const updated = await this.prisma.$transaction(async (tx) => {
      if (resolvedLines) {
        await tx.creditNoteLine.deleteMany({ where: { creditNoteId } });
      }
      const creditNote = await tx.creditNote.update({
        where: {
          id: creditNoteId,
          ...(input.version !== undefined ? { version: input.version } : {}),
        },
        data: {
          contactId: contact.id,
          currency,
          subtotalMinor: totals.subtotalMinor,
          taxTotalMinor: totals.taxTotalMinor,
          totalMinor: totals.totalMinor,
          version: { increment: 1 },
          ...(resolvedLines
            ? {
                lines: {
                  create: resolvedLines.map((line, index) =>
                    lineCreateData(line, index, context.id),
                  ),
                },
              }
            : {}),
        },
        include: creditNoteDetailInclude,
      });

      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'sales.credit_note_updated',
        entityType: 'credit_note',
        entityId: creditNoteId,
        action: AuditAction.UPDATE,
        before: { totalMinor: existing.totalMinor.toString() },
        after: { totalMinor: totals.totalMinor.toString() },
        ipHash: metadata.ipHash,
      });

      return creditNote;
    });

    return summarizeCreditNote(updated);
  }

  /**
   * Issues a draft credit note: freezes each line's tax snapshot exactly like
   * `InvoicesService#issueInvoice`, but every sign is flipped relative to an invoice -- revenue and
   * tax are debited (reversing the original sale), and the single control line credits
   * `customer_credit` instead of debiting `accounts_receivable`.
   */
  async issueCreditNote(
    context: OrganizationContext,
    user: PublicUser,
    creditNoteId: string,
    metadata: RequestMetadata,
    idempotencyKey?: string,
  ) {
    const issued = await this.prisma.$transaction(async (tx) => {
      await this.lockCreditNoteIdempotency(tx, context.id, 'CREDIT_NOTE_ISSUE', idempotencyKey);
      const existingResult = await this.findCreditNoteIdempotentResult(
        context.id,
        'CREDIT_NOTE_ISSUE',
        idempotencyKey,
        tx,
      );
      if (existingResult) {
        return tx.creditNote.findFirstOrThrow({
          where: { id: existingResult.resourceId, organizationId: context.id },
          include: creditNoteDetailInclude,
        });
      }

      await this.lockCreditNoteRow(tx, context.id, creditNoteId);
      const creditNote = await tx.creditNote.findFirst({
        where: { id: creditNoteId, organizationId: context.id },
        include: creditNoteDetailInclude,
      });
      if (!creditNote) throw new NotFoundException('Credit note not found.');
      await assertNoPendingApproval(tx, context.id, 'CREDIT_NOTE', creditNoteId);
      if (creditNote.status !== 'DRAFT') {
        throw new ConflictException('Only draft credit notes can be issued.');
      }
      if (creditNote.lines.length === 0) {
        throw new BadRequestException(
          'A credit note needs at least one line before it can be issued.',
        );
      }

      const issueDate = dateOnly(new Date());

      const customerCreditAccount = await this.ledger.accountBySystemKey(
        context.id,
        'customer_credit',
        tx,
      );

      const revenueByAccount = new Map<string, bigint>();
      const taxByCode = new Map<string, { accountId: string; amountMinor: bigint }>();
      let subtotalMinor = 0n;
      let taxTotalMinor = 0n;

      for (const line of creditNote.lines) {
        subtotalMinor += line.lineTotalMinor;
        const revenueAccountId =
          line.revenueAccountId ??
          (await this.ledger.accountBySystemKey(context.id, 'sales_revenue', tx)).id;
        revenueByAccount.set(
          revenueAccountId,
          (revenueByAccount.get(revenueAccountId) ?? 0n) + line.lineTotalMinor,
        );

        if (line.taxCodeId) {
          const resolved = await this.tax.resolveForPosting(
            tx,
            context.id,
            line.taxCodeId,
            line.lineTotalMinor,
            issueDate,
          );
          await tx.creditNoteLine.update({
            where: { id: line.id },
            data: {
              taxCodeSnapshot: resolved.taxCode,
              taxTreatmentSnapshot: resolved.treatment,
              taxRecoverableSnapshot: resolved.recoverable,
              taxRatePercentSnapshot: resolved.ratePercent,
              taxableAmountMinor: resolved.taxableAmountMinor,
              taxAmountMinor: resolved.taxAmountMinor,
            },
          });
          if (resolved.taxAmountMinor > 0n) {
            const taxAccountId =
              resolved.salesTaxAccountId ??
              (await this.ledger.accountBySystemKey(context.id, 'tax_payable', tx)).id;
            const current = taxByCode.get(line.taxCodeId) ?? {
              accountId: taxAccountId,
              amountMinor: 0n,
            };
            current.amountMinor += resolved.taxAmountMinor;
            taxByCode.set(line.taxCodeId, current);
            taxTotalMinor += resolved.taxAmountMinor;
          }
        }
      }

      const totalMinor = subtotalMinor + taxTotalMinor;
      if (totalMinor <= 0n) {
        throw new BadRequestException('A credit note total must be greater than zero.');
      }

      const description = `Credit note for ${creditNote.contact.displayName}`;
      const journalLines = [
        ...[...revenueByAccount.entries()].map(([accountId, amountMinor]) => ({
          accountId,
          debitMinor: amountMinor,
          creditMinor: 0n,
          description,
        })),
        ...[...taxByCode.values()].map((entry) => ({
          accountId: entry.accountId,
          debitMinor: entry.amountMinor,
          creditMinor: 0n,
          description: `Credit note tax for ${creditNote.contact.displayName}`,
        })),
        {
          accountId: customerCreditAccount.id,
          debitMinor: 0n,
          creditMinor: totalMinor,
          description,
        },
      ];

      const postedJournal = await this.ledger.postJournalFromLines(
        context,
        user,
        'CREDIT_NOTE_ISSUE',
        {
          journalDate: new Date(`${issueDate}T00:00:00.000Z`),
          currency: creditNote.currency,
          description,
          sourceType: 'CREDIT_NOTE',
          sourceId: creditNote.id,
          lines: journalLines,
        },
        metadata,
        undefined,
        tx,
      );

      const allocation = await this.numbering.allocateDocumentNumberWithClient(
        tx,
        context.id,
        CREDIT_NOTE_DOCUMENT_TYPE,
        new Date(`${issueDate}T00:00:00.000Z`),
      );

      const updated = await tx.creditNote.update({
        where: { id: creditNoteId },
        data: {
          status: 'ISSUED',
          creditNoteNumber: allocation.value,
          issueDate: isoDate(issueDate),
          subtotalMinor,
          taxTotalMinor,
          totalMinor,
          remainingMinor: totalMinor,
          journalId: postedJournal.id,
        },
        include: creditNoteDetailInclude,
      });

      // Freeze the exact display data the PDF renders from, in the same transaction that issues the
      // credit note (GAPS #38): a later customer rename or org restyle must not restate the issued
      // document. `updated` carries the lines with their just-frozen tax snapshots.
      await tx.creditNote.update({
        where: { id: creditNoteId },
        data: {
          pdfSnapshot: buildPdfRenderSnapshot({
            organizationName: context.legalName,
            contactName: updated.contact.displayName,
            number: updated.creditNoteNumber,
            issueDate: updated.issueDate ? dateOnly(updated.issueDate) : null,
            currency: updated.currency,
            subtotalMinor: updated.subtotalMinor.toString(),
            taxTotalMinor: updated.taxTotalMinor.toString(),
            totalMinor: updated.totalMinor.toString(),
            lines: updated.lines.map((line) => ({
              descriptionSnapshot: line.descriptionSnapshot,
              quantity: line.quantity,
              unitPriceMinor: line.unitPriceMinor,
              discountMinor: line.discountMinor,
              lineTotalMinor: line.lineTotalMinor,
            })),
          }),
        },
      });
      await this.recordCreditNoteIdempotency(
        tx,
        context.id,
        'CREDIT_NOTE_ISSUE',
        idempotencyKey,
        creditNoteId,
      );
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'sales.credit_note_issued',
        entityType: 'credit_note',
        entityId: creditNoteId,
        action: AuditAction.UPDATE,
        before: { status: 'DRAFT' },
        after: {
          status: 'ISSUED',
          creditNoteNumber: allocation.value,
          totalMinor: totalMinor.toString(),
        },
        ipHash: metadata.ipHash,
      });

      return updated;
    });

    return summarizeCreditNote(issued);
  }

  /** Only allowed while nothing has been applied or refunded yet, mirroring how an issued invoice can
   * only be voided while `paidMinor === 0n`. */
  async voidCreditNote(
    context: OrganizationContext,
    user: PublicUser,
    creditNoteId: string,
    metadata: RequestMetadata,
  ) {
    const existing = await this.findOrThrow(context.id, creditNoteId);
    if (existing.status !== 'ISSUED') {
      throw new ConflictException('Only issued credit notes can be voided.');
    }
    if (existing.remainingMinor !== existing.totalMinor) {
      throw new ConflictException(
        'A credit note with allocations or refunds applied cannot be voided.',
      );
    }
    if (!existing.journalId) {
      throw new ConflictException('This credit note has no posted journal to reverse.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.ledger.reverseJournal(
        context,
        user,
        existing.journalId!,
        { description: `Void of credit note ${existing.creditNoteNumber ?? existing.id}` },
        metadata,
        undefined,
        tx,
      );

      const creditNote = await tx.creditNote.update({
        where: { id: creditNoteId },
        data: { status: 'VOID', voidedAt: new Date() },
        include: creditNoteDetailInclude,
      });

      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'sales.credit_note_voided',
        entityType: 'credit_note',
        entityId: creditNoteId,
        action: AuditAction.UPDATE,
        before: { status: existing.status },
        after: { status: 'VOID' },
        ipHash: metadata.ipHash,
      });

      return creditNote;
    });

    return summarizeCreditNote(updated);
  }

  async openInvoicesFor(organizationId: string, creditNoteId: string) {
    const creditNote = await this.findOrThrow(organizationId, creditNoteId);
    const invoices = await this.prisma.invoice.findMany({
      where: {
        organizationId,
        contactId: creditNote.contactId,
        status: { in: [...OPEN_INVOICE_STATUSES] },
        balanceMinor: { gt: 0n },
      },
      orderBy: [{ issueDate: 'asc' }],
      select: {
        id: true,
        invoiceNumber: true,
        issueDate: true,
        dueDate: true,
        currency: true,
        totalMinor: true,
        paidMinor: true,
        balanceMinor: true,
      },
    });
    return invoices.map((invoice) => ({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      issueDate: invoice.issueDate ? dateOnly(invoice.issueDate) : null,
      dueDate: invoice.dueDate ? dateOnly(invoice.dueDate) : null,
      currency: invoice.currency,
      totalMinor: invoice.totalMinor.toString(),
      paidMinor: invoice.paidMinor.toString(),
      balanceMinor: invoice.balanceMinor.toString(),
    }));
  }

  /**
   * Applies an issued credit note's remaining balance against one or more open invoices. Unlike
   * `PaymentsService#allocate`, this posts a real journal (`DR customer_credit, CR
   * accounts_receivable`) *per invoice* -- each `CreditNoteAllocation` row owns its own journal, so a
   * call touching three invoices posts three journals inside one transaction. Locking mirrors
   * Payments exactly: credit note row first, then invoice rows in ascending id order, balances
   * re-read only after both locks are held, both invariants checked before any write.
   */
  async allocate(
    context: OrganizationContext,
    user: PublicUser,
    creditNoteId: string,
    input: AllocateCreditNoteDto,
    metadata: RequestMetadata,
    idempotencyKey?: string,
  ) {
    const requestedByInvoice = new Map<string, bigint>();
    for (const line of input.allocations) {
      if (requestedByInvoice.has(line.invoiceId)) {
        throw new BadRequestException(
          `Invoice ${line.invoiceId} appears more than once in this allocation request.`,
        );
      }
      const amount = BigInt(line.amountMinor);
      if (amount <= 0n) {
        throw new BadRequestException('Each allocation amount must be greater than zero.');
      }
      requestedByInvoice.set(line.invoiceId, amount);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.lockCreditNoteIdempotency(tx, context.id, 'CREDIT_NOTE_ALLOCATE', idempotencyKey);
      const existingResult = await this.findCreditNoteIdempotentResult(
        context.id,
        'CREDIT_NOTE_ALLOCATE',
        idempotencyKey,
        tx,
      );
      if (existingResult) {
        return tx.creditNote.findFirstOrThrow({
          where: { id: existingResult.resourceId, organizationId: context.id },
          include: creditNoteDetailInclude,
        });
      }

      await this.lockCreditNoteRow(tx, context.id, creditNoteId);
      const creditNote = await tx.creditNote.findFirst({
        where: { id: creditNoteId, organizationId: context.id },
        include: { contact: { select: { receivableAccountId: true, displayName: true } } },
      });
      if (!creditNote) throw new NotFoundException('Credit note not found.');
      if (creditNote.status !== 'ISSUED') {
        throw new ConflictException('This credit note has no remaining balance to allocate.');
      }

      const sortedInvoiceIds = [...requestedByInvoice.keys()].sort();
      await this.lockInvoiceRowsInOrder(tx, context.id, sortedInvoiceIds);
      const invoices = await tx.invoice.findMany({
        where: { id: { in: sortedInvoiceIds }, organizationId: context.id },
      });
      const invoicesById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
      for (const invoiceId of sortedInvoiceIds) {
        const invoice = invoicesById.get(invoiceId);
        if (!invoice) throw new NotFoundException(`Invoice ${invoiceId} not found.`);
        if (invoice.contactId !== creditNote.contactId) {
          throw new ConflictException(
            `Invoice ${invoiceId} does not belong to this credit note's customer.`,
          );
        }
        if (invoice.status !== 'ISSUED' && invoice.status !== 'PARTIALLY_PAID') {
          throw new ConflictException(`Invoice ${invoiceId} is not open for allocation.`);
        }
      }

      const totalRequestedMinor = [...requestedByInvoice.values()].reduce(
        (sum, amount) => sum + amount,
        0n,
      );
      if (totalRequestedMinor > creditNote.remainingMinor) {
        throw new ConflictException(
          "Allocation total exceeds the credit note's remaining balance.",
        );
      }
      for (const [invoiceId, amount] of requestedByInvoice) {
        const invoice = invoicesById.get(invoiceId)!;
        if (amount > invoice.balanceMinor) {
          throw new ConflictException(
            `Allocation for invoice ${invoiceId} exceeds its remaining balance.`,
          );
        }
      }

      const customerCreditAccount = await this.ledger.accountBySystemKey(
        context.id,
        'customer_credit',
        tx,
      );
      const arAccount = creditNote.contact.receivableAccountId
        ? await tx.ledgerAccount.findUniqueOrThrow({
            where: { id: creditNote.contact.receivableAccountId },
          })
        : await this.ledger.accountBySystemKey(context.id, 'accounts_receivable', tx);
      const today = new Date(`${dateOnly(new Date())}T00:00:00.000Z`);

      for (const [invoiceId, amount] of requestedByInvoice) {
        const invoice = invoicesById.get(invoiceId)!;
        const postedJournal = await this.ledger.postJournalFromLines(
          context,
          user,
          'CREDIT_NOTE_ALLOCATE',
          {
            journalDate: today,
            currency: creditNote.currency,
            description: `Credit note ${creditNote.creditNoteNumber ?? creditNote.id} applied to invoice ${invoice.invoiceNumber ?? invoice.id}`,
            sourceType: 'CREDIT_NOTE_ALLOCATION',
            sourceId: creditNoteId,
            lines: [
              { accountId: customerCreditAccount.id, debitMinor: amount, creditMinor: 0n },
              { accountId: arAccount.id, debitMinor: 0n, creditMinor: amount },
            ],
          },
          metadata,
          undefined,
          tx,
        );

        await tx.creditNoteAllocation.create({
          data: {
            organizationId: context.id,
            creditNoteId,
            invoiceId,
            amountMinor: amount,
            journalId: postedJournal.id,
          },
        });

        const newBalanceMinor = invoice.balanceMinor - amount;
        await tx.invoice.update({
          where: { id: invoiceId },
          data: {
            paidMinor: invoice.paidMinor + amount,
            balanceMinor: newBalanceMinor,
            status: newBalanceMinor === 0n ? 'PAID' : 'PARTIALLY_PAID',
          },
        });
      }

      const newRemainingMinor = creditNote.remainingMinor - totalRequestedMinor;
      const updatedCreditNote = await tx.creditNote.update({
        where: { id: creditNoteId },
        data: {
          appliedMinor: creditNote.appliedMinor + totalRequestedMinor,
          remainingMinor: newRemainingMinor,
          status: newRemainingMinor === 0n ? 'APPLIED' : 'ISSUED',
        },
        include: creditNoteDetailInclude,
      });

      await this.recordCreditNoteIdempotency(
        tx,
        context.id,
        'CREDIT_NOTE_ALLOCATE',
        idempotencyKey,
        creditNoteId,
      );
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'sales.credit_note_allocated',
        entityType: 'credit_note',
        entityId: creditNoteId,
        action: AuditAction.UPDATE,
        after: {
          totalRequestedMinor: totalRequestedMinor.toString(),
          invoiceIds: sortedInvoiceIds,
        },
        ipHash: metadata.ipHash,
      });

      return updatedCreditNote;
    });

    return summarizeCreditNote(updated);
  }

  /** Pays out the credit note's remaining balance in cash. May be called more than once for partial
   * refunds -- `CreditNoteRefund` is a per-event table for exactly that reason. */
  async refund(
    context: OrganizationContext,
    user: PublicUser,
    creditNoteId: string,
    input: RefundCreditNoteDto,
    metadata: RequestMetadata,
    idempotencyKey?: string,
  ) {
    const amount = BigInt(input.amountMinor);
    if (amount <= 0n) {
      throw new BadRequestException('A refund amount must be greater than zero.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.lockCreditNoteIdempotency(tx, context.id, 'CREDIT_NOTE_REFUND', idempotencyKey);
      const existingResult = await this.findCreditNoteIdempotentResult(
        context.id,
        'CREDIT_NOTE_REFUND',
        idempotencyKey,
        tx,
      );
      if (existingResult) {
        return tx.creditNote.findFirstOrThrow({
          where: { id: existingResult.resourceId, organizationId: context.id },
          include: creditNoteDetailInclude,
        });
      }

      await this.lockCreditNoteRow(tx, context.id, creditNoteId);
      const creditNote = await tx.creditNote.findFirst({
        where: { id: creditNoteId, organizationId: context.id },
      });
      if (!creditNote) throw new NotFoundException('Credit note not found.');
      if (creditNote.status !== 'ISSUED') {
        throw new ConflictException('This credit note has no remaining balance to refund.');
      }
      if (amount > creditNote.remainingMinor) {
        throw new ConflictException("Refund amount exceeds the credit note's remaining balance.");
      }

      const customerCreditAccount = await this.ledger.accountBySystemKey(
        context.id,
        'customer_credit',
        tx,
      );
      const bankAccount = await this.ledger.accountBySystemKey(context.id, 'bank_default', tx);
      const today = new Date(`${dateOnly(new Date())}T00:00:00.000Z`);

      const postedJournal = await this.ledger.postJournalFromLines(
        context,
        user,
        'CREDIT_NOTE_REFUND',
        {
          journalDate: today,
          currency: creditNote.currency,
          description: `Refund of credit note ${creditNote.creditNoteNumber ?? creditNote.id}`,
          sourceType: 'CREDIT_NOTE_REFUND',
          sourceId: creditNoteId,
          lines: [
            { accountId: customerCreditAccount.id, debitMinor: amount, creditMinor: 0n },
            { accountId: bankAccount.id, debitMinor: 0n, creditMinor: amount },
          ],
        },
        metadata,
        undefined,
        tx,
      );

      await tx.creditNoteRefund.create({
        data: {
          organizationId: context.id,
          creditNoteId,
          amountMinor: amount,
          journalId: postedJournal.id,
          createdByUserId: user.id,
        },
      });

      const newRemainingMinor = creditNote.remainingMinor - amount;
      const updatedCreditNote = await tx.creditNote.update({
        where: { id: creditNoteId },
        data: {
          refundedMinor: creditNote.refundedMinor + amount,
          remainingMinor: newRemainingMinor,
          status: newRemainingMinor === 0n ? 'REFUNDED' : 'ISSUED',
        },
        include: creditNoteDetailInclude,
      });

      await this.recordCreditNoteIdempotency(
        tx,
        context.id,
        'CREDIT_NOTE_REFUND',
        idempotencyKey,
        creditNoteId,
      );
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'sales.credit_note_refunded',
        entityType: 'credit_note',
        entityId: creditNoteId,
        action: AuditAction.UPDATE,
        after: { amountMinor: amount.toString() },
        ipHash: metadata.ipHash,
      });

      return updatedCreditNote;
    });

    return summarizeCreditNote(updated);
  }

  /** Renders the credit note to PDF (cached -- a re-send never re-renders) and enqueues an email job
   * with the PDF as a pre-signed-URL attachment. `sentAt` updates on every successful send. */
  async sendCreditNote(
    context: OrganizationContext,
    user: PublicUser,
    creditNoteId: string,
    metadata: RequestMetadata,
  ) {
    const existing = await this.findOrThrow(context.id, creditNoteId);
    if (existing.status === 'DRAFT' || existing.status === 'VOID') {
      throw new ConflictException('Only issued credit notes can be sent.');
    }
    if (!existing.contact.email) {
      throw new BadRequestException('This customer has no email address on file.');
    }

    // The PDF always renders from the frozen `pdfSnapshot` captured at issue time (GAPS #38) -- never
    // from the live `context.legalName`/`contact.displayName`. Legacy rows fall back unchanged.
    const snapshot = parsePdfRenderSnapshot(existing.pdfSnapshot);
    const html = snapshot
      ? renderCreditNoteHtml(snapshot.organizationName, {
          creditNoteNumber: snapshot.number,
          contactName: snapshot.contactName,
          issueDate: snapshot.issueDate,
          currency: snapshot.currency,
          subtotalMinor: snapshot.subtotalMinor,
          taxTotalMinor: snapshot.taxTotalMinor ?? '0',
          totalMinor: snapshot.totalMinor,
          lines: snapshot.lines,
        })
      : renderCreditNoteHtml(context.legalName, {
          creditNoteNumber: existing.creditNoteNumber,
          contactName: existing.contact.displayName,
          issueDate: existing.issueDate ? dateOnly(existing.issueDate) : null,
          currency: existing.currency,
          subtotalMinor: existing.subtotalMinor.toString(),
          taxTotalMinor: existing.taxTotalMinor.toString(),
          totalMinor: existing.totalMinor.toString(),
          lines: existing.lines.map((line) => ({
            descriptionSnapshot: line.descriptionSnapshot,
            quantity: line.quantity.toString(),
            unitPriceMinor: line.unitPriceMinor.toString(),
            discountMinor: line.discountMinor.toString(),
            lineTotalMinor: line.lineTotalMinor.toString(),
          })),
        });
    const { storageKey } = await this.documentRendering.render(
      context.id,
      'CREDIT_NOTE',
      creditNoteId,
      html,
    );
    const signedUrl = await this.documentRendering.getSignedUrl(storageKey);

    await this.emailQueue.enqueue(EMAIL_JOB_NAMES.creditNoteSend, {
      to: existing.contact.email,
      subject: `Credit note ${existing.creditNoteNumber ?? ''} from ${context.legalName}`,
      text: `Please find attached credit note ${existing.creditNoteNumber ?? ''} from ${context.legalName}.`,
      html: `<p>Please find attached credit note ${existing.creditNoteNumber ?? ''} from ${context.legalName}.</p>`,
      attachments: [
        { filename: `${existing.creditNoteNumber ?? creditNoteId}.pdf`, path: signedUrl },
      ],
    });

    const updated = await this.prisma.$transaction(async (tx) => {
      const creditNote = await tx.creditNote.update({
        where: { id: creditNoteId },
        data: { sentAt: new Date() },
        include: creditNoteDetailInclude,
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'sales.credit_note_sent',
        entityType: 'credit_note',
        entityId: creditNoteId,
        action: AuditAction.UPDATE,
        after: { sentAt: creditNote.sentAt!.toISOString() },
        ipHash: metadata.ipHash,
      });
      return creditNote;
    });

    return summarizeCreditNote(updated);
  }

  private async findOrThrow(organizationId: string, creditNoteId: string) {
    const creditNote = await this.prisma.creditNote.findFirst({
      where: { id: creditNoteId, organizationId },
      include: creditNoteDetailInclude,
    });
    if (!creditNote) throw new NotFoundException('Credit note not found.');
    return creditNote;
  }

  private async resolveLines(
    context: OrganizationContext,
    currency: string,
    lines: readonly CreditNoteLineDto[],
  ) {
    const organizationId = context.id;
    if (
      lines.some((line) => line.revenueAccountId) &&
      !context.permissions.has('sales.invoices.revenue_account_override')
    ) {
      throw new BadRequestException(
        'Only members with revenue-account-override permission can set a line revenue account.',
      );
    }
    const itemIds = Array.from(
      new Set(lines.map((line) => line.itemId).filter((id): id is string => Boolean(id))),
    );
    const items =
      itemIds.length === 0
        ? []
        : await this.prisma.item.findMany({
            where: { id: { in: itemIds }, organizationId },
            include: { prices: true },
          });
    const itemsById = new Map(items.map((item) => [item.id, item]));

    return lines.map((line, index) => {
      const label = `Line ${index + 1}`;
      const item = line.itemId ? itemsById.get(line.itemId) : undefined;
      if (line.itemId && !item) throw new BadRequestException(`${label}: item not found.`);
      if (item && item.status !== 'ACTIVE') {
        throw new BadRequestException(`${label}: item is not active.`);
      }

      const descriptionOverrideAllowed = !item || item.freeDescriptionAllowed;
      if (!item && !line.description) {
        throw new BadRequestException(`${label}: needs a description or an item.`);
      }
      if (item && line.description && !descriptionOverrideAllowed) {
        throw new BadRequestException(
          `${label}: this item does not allow a free-text description.`,
        );
      }
      const descriptionSnapshot = line.description ?? item?.name;
      if (!descriptionSnapshot) throw new BadRequestException(`${label}: needs a description.`);

      const unitPriceMinor = line.unitPriceMinor
        ? BigInt(line.unitPriceMinor)
        : resolveDefaultPrice(item, currency, label);

      const discountMinor = line.discountMinor ? BigInt(line.discountMinor) : 0n;
      const lineTotalMinor = computeLineTotal(label, line.quantity, unitPriceMinor, discountMinor);

      return {
        itemId: item?.id ?? null,
        descriptionSnapshot,
        quantity: line.quantity,
        unitPriceMinor,
        discountMinor,
        lineTotalMinor,
        taxCodeId: line.taxCodeId ?? item?.defaultTaxCodeId ?? null,
        revenueAccountId: line.revenueAccountId ?? item?.revenueAccountId ?? null,
        projectTag: line.projectTag ?? null,
      };
    });
  }

  private async lockCreditNoteIdempotency(
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

  private async findCreditNoteIdempotentResult(
    organizationId: string,
    operation: string,
    key: string | undefined,
    tx: Prisma.TransactionClient,
  ): Promise<{ resourceId: string } | null> {
    if (!key) return null;
    return tx.ledgerIdempotencyKey.findUnique({
      where: { organizationId_operation_key: { organizationId, operation, key } },
      select: { resourceId: true },
    });
  }

  private recordCreditNoteIdempotency(
    tx: Prisma.TransactionClient,
    organizationId: string,
    operation: string,
    key: string | undefined,
    creditNoteId: string,
  ) {
    if (!key) return undefined;
    return tx.ledgerIdempotencyKey.create({
      data: {
        organizationId,
        operation,
        key,
        resourceType: 'CREDIT_NOTE',
        resourceId: creditNoteId,
      },
    });
  }

  private async lockCreditNoteRow(
    tx: Prisma.TransactionClient,
    organizationId: string,
    creditNoteId: string,
  ): Promise<void> {
    await tx.$queryRaw`
      SELECT id
      FROM credit_notes
      WHERE id = ${creditNoteId}::uuid AND organization_id = ${organizationId}::uuid
      FOR UPDATE
    `;
  }

  private async lockInvoiceRowsInOrder(
    tx: Prisma.TransactionClient,
    organizationId: string,
    invoiceIds: readonly string[],
  ): Promise<void> {
    if (invoiceIds.length === 0) return;
    await tx.$queryRaw`
      SELECT id
      FROM invoices
      WHERE id = ANY(${invoiceIds}::uuid[]) AND organization_id = ${organizationId}::uuid
      ORDER BY id
      FOR UPDATE
    `;
  }
}

function resolveDefaultPrice(
  item: Prisma.ItemGetPayload<{ include: { prices: true } }> | undefined,
  currency: string,
  label: string,
): bigint {
  const price = item?.prices.find(
    (candidate) => candidate.priceListKey === 'default' && candidate.currency === currency,
  );
  if (!price) {
    throw new BadRequestException(
      `${label}: no unit price given and no default price found for ${currency}.`,
    );
  }
  return price.unitPriceMinor;
}

function computeLineTotal(
  label: string,
  quantity: string,
  unitPriceMinor: bigint,
  discountMinor: bigint,
): bigint {
  const [whole = '0', fraction = ''] = quantity.split('.');
  const quantityScaled = BigInt(whole) * QUANTITY_SCALE + BigInt(fraction.padEnd(4, '0'));
  if (quantityScaled <= 0n)
    throw new BadRequestException(`${label}: quantity must be greater than zero.`);
  const gross = roundHalfUpDivide(quantityScaled * unitPriceMinor, QUANTITY_SCALE);
  const total = gross - discountMinor;
  if (total < 0n) {
    throw new BadRequestException(`${label}: discount cannot exceed the line's gross amount.`);
  }
  return total;
}

function lineTotals(lines: readonly { lineTotalMinor: bigint }[]) {
  const subtotalMinor = lines.reduce((sum, line) => sum + line.lineTotalMinor, 0n);
  // Draft totals are pre-tax previews only; tax is computed and frozen at issue time.
  return { subtotalMinor, taxTotalMinor: 0n, totalMinor: subtotalMinor };
}

function lineCreateData(
  line: {
    itemId: string | null;
    descriptionSnapshot: string;
    quantity: string;
    unitPriceMinor: bigint;
    discountMinor: bigint;
    lineTotalMinor: bigint;
    taxCodeId: string | null;
    revenueAccountId: string | null;
    projectTag: string | null;
  },
  index: number,
  organizationId: string,
) {
  return {
    organizationId,
    lineNumber: index + 1,
    itemId: line.itemId,
    descriptionSnapshot: line.descriptionSnapshot,
    quantity: line.quantity,
    unitPriceMinor: line.unitPriceMinor,
    discountMinor: line.discountMinor,
    lineTotalMinor: line.lineTotalMinor,
    taxCodeId: line.taxCodeId,
    revenueAccountId: line.revenueAccountId,
    projectTag: line.projectTag,
  };
}

function summarizeCreditNote(creditNote: CreditNoteWithDetail) {
  return {
    id: creditNote.id,
    contactId: creditNote.contactId,
    contactName: creditNote.contact.displayName,
    creditNoteNumber: creditNote.creditNoteNumber,
    status: creditNote.status,
    issueDate: creditNote.issueDate ? dateOnly(creditNote.issueDate) : null,
    currency: creditNote.currency,
    subtotalMinor: creditNote.subtotalMinor.toString(),
    taxTotalMinor: creditNote.taxTotalMinor.toString(),
    totalMinor: creditNote.totalMinor.toString(),
    appliedMinor: creditNote.appliedMinor.toString(),
    refundedMinor: creditNote.refundedMinor.toString(),
    remainingMinor: creditNote.remainingMinor.toString(),
    journalId: creditNote.journalId,
    voidedAt: creditNote.voidedAt?.toISOString() ?? null,
    sentAt: creditNote.sentAt?.toISOString() ?? null,
    lines: creditNote.lines.map((line) => ({
      id: line.id,
      lineNumber: line.lineNumber,
      itemId: line.itemId,
      descriptionSnapshot: line.descriptionSnapshot,
      quantity: line.quantity.toString(),
      unitPriceMinor: line.unitPriceMinor.toString(),
      discountMinor: line.discountMinor.toString(),
      lineTotalMinor: line.lineTotalMinor.toString(),
      taxCodeId: line.taxCodeId,
      taxCodeSnapshot: line.taxCodeSnapshot,
      taxTreatmentSnapshot: line.taxTreatmentSnapshot,
      taxRecoverableSnapshot: line.taxRecoverableSnapshot,
      taxRatePercentSnapshot: line.taxRatePercentSnapshot?.toString() ?? null,
      taxableAmountMinor: line.taxableAmountMinor?.toString() ?? null,
      taxAmountMinor: line.taxAmountMinor?.toString() ?? null,
      revenueAccountId: line.revenueAccountId,
      projectTag: line.projectTag,
    })),
    allocations: creditNote.allocations.map((allocation) => ({
      id: allocation.id,
      creditNoteId: allocation.creditNoteId,
      invoiceId: allocation.invoiceId,
      invoiceNumber: allocation.invoice.invoiceNumber,
      amountMinor: allocation.amountMinor.toString(),
      journalId: allocation.journalId,
      createdAt: allocation.createdAt.toISOString(),
    })),
    refunds: creditNote.refunds.map((refund) => ({
      id: refund.id,
      creditNoteId: refund.creditNoteId,
      amountMinor: refund.amountMinor.toString(),
      journalId: refund.journalId,
      createdAt: refund.createdAt.toISOString(),
    })),
    createdAt: creditNote.createdAt.toISOString(),
    updatedAt: creditNote.updatedAt.toISOString(),
    version: creditNote.version,
  };
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isoDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}
