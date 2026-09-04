import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, type Prisma } from '@prisma/client';

import type { PublicUser } from '../auth/auth.service.js';
import { DomainEventsService } from '../automation/domain-events.service.js';
import type { RequestMetadata } from '../auth/request-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { writeAuditEvent } from '../organizations/audit-event.js';
import { PAYMENT_RECEIVED_DOCUMENT_TYPE } from '../organizations/document-numbering.js';
import { DocumentNumberingService } from '../organizations/document-numbering.service.js';
import { LedgerService } from '../organizations/ledger.service.js';
import type { OrganizationContext } from '../organizations/organization-context.js';
import type { AllocatePaymentDto, CreatePaymentDto } from './payments.dto.js';

type PaymentWithAllocations = Prisma.PaymentReceivedGetPayload<{
  include: typeof paymentDetailInclude;
}>;

const paymentDetailInclude = {
  allocations: {
    include: { invoice: { select: { id: true, invoiceNumber: true } } },
  },
  contact: { select: { id: true, displayName: true, currency: true, receivableAccountId: true } },
} satisfies Prisma.PaymentReceivedInclude;

const OPEN_INVOICE_STATUSES = ['ISSUED', 'PARTIALLY_PAID'] as const;

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly numbering: DocumentNumberingService,
    private readonly events: DomainEventsService,
  ) {}

  async list(organizationId: string, status?: string) {
    const payments = await this.prisma.paymentReceived.findMany({
      where: { organizationId, ...(status ? { status: status as never } : {}) },
      orderBy: [{ createdAt: 'desc' }],
      include: paymentDetailInclude,
      take: 200,
    });
    return payments.map(summarizePayment);
  }

  async detail(organizationId: string, paymentId: string) {
    const payment = await this.findOrThrow(organizationId, paymentId);
    return summarizePayment(payment);
  }

  async openInvoicesFor(organizationId: string, paymentId: string) {
    const payment = await this.findOrThrow(organizationId, paymentId);
    const invoices = await this.prisma.invoice.findMany({
      where: {
        organizationId,
        contactId: payment.contactId,
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
   * Records a customer payment and posts its deposit-account debit / AR credit journal in one step
   * -- unlike Invoice, there is no draft state (PHASE2_TODO: "post once at recording time"). The
   * `PaymentReceived` row is created *before* the journal post (rather than after, as
   * `InvoicesService#issueInvoice` does with an already-existing draft) because
   * `postJournalFromLines` needs a `sourceId`; both happen inside the same transaction, so the
   * intermediate unposted state is never observable to another connection. Idempotency is scoped to
   * this service (operation `'PAYMENT_RECEIVED_RECORD'`), mirroring `InvoicesService`'s own
   * invoice-scoped idempotency rather than reusing `LedgerService`'s private helpers.
   */
  async record(
    context: OrganizationContext,
    user: PublicUser,
    input: CreatePaymentDto,
    metadata: RequestMetadata,
    idempotencyKey?: string,
  ) {
    const contact = await this.prisma.contact.findFirst({
      where: { id: input.contactId, organizationId: context.id, type: 'CUSTOMER' },
    });
    if (!contact) throw new NotFoundException('Customer not found.');
    if (contact.status !== 'ACTIVE') {
      throw new ConflictException('Cannot record a payment for a deactivated customer.');
    }
    const currency = input.currency ?? contact.currency;
    const amountMinor = BigInt(input.amountMinor);
    if (amountMinor <= 0n) {
      throw new BadRequestException('A payment amount must be greater than zero.');
    }
    const receivedDate = isoDate(input.receivedDate);

    const recorded = await this.prisma.$transaction(async (tx) => {
      await this.lockPaymentIdempotency(tx, context.id, 'PAYMENT_RECEIVED_RECORD', idempotencyKey);
      const existingResult = await this.findPaymentIdempotentResult(
        context.id,
        'PAYMENT_RECEIVED_RECORD',
        idempotencyKey,
        tx,
      );
      if (existingResult) {
        return tx.paymentReceived.findFirstOrThrow({
          where: { id: existingResult.resourceId, organizationId: context.id },
          include: paymentDetailInclude,
        });
      }

      const depositAccount = await this.ledger.accountBySystemKey(context.id, 'bank_default', tx);
      const arAccount = contact.receivableAccountId
        ? await tx.ledgerAccount.findUniqueOrThrow({ where: { id: contact.receivableAccountId } })
        : await this.ledger.accountBySystemKey(context.id, 'accounts_receivable', tx);

      const payment = await tx.paymentReceived.create({
        data: {
          organizationId: context.id,
          contactId: contact.id,
          status: 'UNAPPLIED',
          receivedDate,
          currency,
          amountMinor,
          allocatedMinor: 0n,
          unappliedMinor: amountMinor,
          depositAccountId: depositAccount.id,
          createdByUserId: user.id,
        },
      });

      const postedJournal = await this.ledger.postJournalFromLines(
        context,
        user,
        'PAYMENT_RECEIVED_RECORD',
        {
          journalDate: receivedDate,
          currency,
          description: `Payment from ${contact.displayName}`,
          sourceType: 'PAYMENT_RECEIVED',
          sourceId: payment.id,
          lines: [
            {
              accountId: depositAccount.id,
              debitMinor: amountMinor,
              creditMinor: 0n,
              description: `Payment from ${contact.displayName}`,
            },
            {
              accountId: arAccount.id,
              debitMinor: 0n,
              creditMinor: amountMinor,
              description: `Payment from ${contact.displayName}`,
            },
          ],
        },
        metadata,
        undefined,
        tx,
      );

      const allocation = await this.numbering.allocateDocumentNumberWithClient(
        tx,
        context.id,
        PAYMENT_RECEIVED_DOCUMENT_TYPE,
        receivedDate,
      );

      const updated = await tx.paymentReceived.update({
        where: { id: payment.id },
        data: { paymentNumber: allocation.value, journalId: postedJournal.id },
        include: paymentDetailInclude,
      });

      await this.recordPaymentIdempotency(
        tx,
        context.id,
        'PAYMENT_RECEIVED_RECORD',
        idempotencyKey,
        payment.id,
      );
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'sales.payment_received_recorded',
        entityType: 'payment_received',
        entityId: payment.id,
        action: AuditAction.CREATE,
        after: { contactId: contact.id, amountMinor: amountMinor.toString() },
        ipHash: metadata.ipHash,
      });
      await this.events.emit(tx, {
        organizationId: context.id,
        aggregateType: 'payment_received',
        aggregateId: payment.id,
        eventName: 'payment.recorded',
        payload: {
          paymentId: payment.id,
          contactId: contact.id,
          amountMinor: amountMinor.toString(),
          currency,
        },
      });

      return updated;
    });

    return summarizePayment(recorded);
  }

  /**
   * Applies a recorded payment against one or more of the customer's open invoices. This is the
   * money-invariant-critical method: locks are taken in a fixed order (payment row, then invoice
   * rows in ascending id order) so that any future unallocate/void path taking the same two locks
   * cannot deadlock against a concurrent `allocate` call. Balances are re-read only after both locks
   * are held, and both invariants -- the whole-call total against `payment.unappliedMinor`, and each
   * invoice's own existing-plus-requested against `invoice.balanceMinor` -- are checked before any
   * row is written, so a violation rolls back the entire transaction with no partial allocation.
   */
  async allocate(
    context: OrganizationContext,
    user: PublicUser,
    paymentId: string,
    input: AllocatePaymentDto,
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
      await this.lockPaymentIdempotency(tx, context.id, 'PAYMENT_ALLOCATE', idempotencyKey);
      const existingResult = await this.findPaymentIdempotentResult(
        context.id,
        'PAYMENT_ALLOCATE',
        idempotencyKey,
        tx,
      );
      if (existingResult) {
        return tx.paymentReceived.findFirstOrThrow({
          where: { id: existingResult.resourceId, organizationId: context.id },
          include: paymentDetailInclude,
        });
      }

      // Lock order, fixed for all time: payment row first, then invoice rows ascending by id.
      await this.lockPaymentRow(tx, context.id, paymentId);
      const payment = await tx.paymentReceived.findFirst({
        where: { id: paymentId, organizationId: context.id },
      });
      if (!payment) throw new NotFoundException('Payment not found.');

      const sortedInvoiceIds = [...requestedByInvoice.keys()].sort();
      await this.lockInvoiceRowsInOrder(tx, context.id, sortedInvoiceIds);
      const invoices = await tx.invoice.findMany({
        where: { id: { in: sortedInvoiceIds }, organizationId: context.id },
      });
      const invoicesById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
      for (const invoiceId of sortedInvoiceIds) {
        const invoice = invoicesById.get(invoiceId);
        if (!invoice) throw new NotFoundException(`Invoice ${invoiceId} not found.`);
        if (invoice.contactId !== payment.contactId) {
          throw new ConflictException(
            `Invoice ${invoiceId} does not belong to this payment's customer.`,
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
      if (totalRequestedMinor > payment.unappliedMinor) {
        throw new ConflictException("Allocation total exceeds the payment's unapplied amount.");
      }

      // `invoice.balanceMinor` is already net of every prior allocation against this invoice --
      // from this payment or any other -- since it is decremented atomically each time an
      // allocation is applied. So the guard compares the newly requested amount directly against
      // the fresh balance; re-adding this payment's own prior allocations here would double-count
      // an amount the balance has already had subtracted from it.
      for (const [invoiceId, amount] of requestedByInvoice) {
        const invoice = invoicesById.get(invoiceId)!;
        if (amount > invoice.balanceMinor) {
          throw new ConflictException(
            `Allocation for invoice ${invoiceId} exceeds its remaining balance.`,
          );
        }
      }

      for (const [invoiceId, amount] of requestedByInvoice) {
        const invoice = invoicesById.get(invoiceId)!;
        await tx.paymentAllocation.upsert({
          where: { paymentId_invoiceId: { paymentId, invoiceId } },
          create: { organizationId: context.id, paymentId, invoiceId, amountMinor: amount },
          update: { amountMinor: { increment: amount } },
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

      const newAllocatedMinor = payment.allocatedMinor + totalRequestedMinor;
      const newUnappliedMinor = payment.unappliedMinor - totalRequestedMinor;
      const updatedPayment = await tx.paymentReceived.update({
        where: { id: paymentId },
        data: {
          allocatedMinor: newAllocatedMinor,
          unappliedMinor: newUnappliedMinor,
          status: newUnappliedMinor === 0n ? 'FULLY_ALLOCATED' : 'PARTIALLY_ALLOCATED',
        },
        include: paymentDetailInclude,
      });

      await this.recordPaymentIdempotency(
        tx,
        context.id,
        'PAYMENT_ALLOCATE',
        idempotencyKey,
        paymentId,
      );
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'sales.payment_allocated',
        entityType: 'payment_received',
        entityId: paymentId,
        action: AuditAction.UPDATE,
        after: {
          totalRequestedMinor: totalRequestedMinor.toString(),
          invoiceIds: sortedInvoiceIds,
        },
        ipHash: metadata.ipHash,
      });

      return updatedPayment;
    });

    return summarizePayment(updated);
  }

  private async findOrThrow(organizationId: string, paymentId: string) {
    const payment = await this.prisma.paymentReceived.findFirst({
      where: { id: paymentId, organizationId },
      include: paymentDetailInclude,
    });
    if (!payment) throw new NotFoundException('Payment not found.');
    return payment;
  }

  private async lockPaymentIdempotency(
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

  private async findPaymentIdempotentResult(
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

  private recordPaymentIdempotency(
    tx: Prisma.TransactionClient,
    organizationId: string,
    operation: string,
    key: string | undefined,
    paymentId: string,
  ) {
    if (!key) return undefined;
    return tx.ledgerIdempotencyKey.create({
      data: {
        organizationId,
        operation,
        key,
        resourceType: 'PAYMENT_RECEIVED',
        resourceId: paymentId,
      },
    });
  }

  private async lockPaymentRow(
    tx: Prisma.TransactionClient,
    organizationId: string,
    paymentId: string,
  ): Promise<void> {
    await tx.$queryRaw`
      SELECT id
      FROM payments_received
      WHERE id = ${paymentId}::uuid AND organization_id = ${organizationId}::uuid
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

function summarizePayment(payment: PaymentWithAllocations) {
  return {
    id: payment.id,
    contactId: payment.contactId,
    contactName: payment.contact.displayName,
    paymentNumber: payment.paymentNumber,
    status: payment.status,
    receivedDate: dateOnly(payment.receivedDate),
    currency: payment.currency,
    amountMinor: payment.amountMinor.toString(),
    allocatedMinor: payment.allocatedMinor.toString(),
    unappliedMinor: payment.unappliedMinor.toString(),
    depositAccountId: payment.depositAccountId,
    journalId: payment.journalId,
    allocations: payment.allocations.map((allocation) => ({
      id: allocation.id,
      paymentId: allocation.paymentId,
      invoiceId: allocation.invoiceId,
      invoiceNumber: allocation.invoice.invoiceNumber,
      amountMinor: allocation.amountMinor.toString(),
      createdAt: allocation.createdAt.toISOString(),
    })),
    createdAt: payment.createdAt.toISOString(),
    updatedAt: payment.updatedAt.toISOString(),
  };
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isoDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}
