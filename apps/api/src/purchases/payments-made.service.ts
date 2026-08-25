import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, type Prisma } from '@prisma/client';

import type { PublicUser } from '../auth/auth.service.js';
import type { RequestMetadata } from '../auth/request-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { writeAuditEvent } from '../organizations/audit-event.js';
import { PAYMENT_MADE_DOCUMENT_TYPE } from '../organizations/document-numbering.js';
import { DocumentNumberingService } from '../organizations/document-numbering.service.js';
import { LedgerService } from '../organizations/ledger.service.js';
import type { OrganizationContext } from '../organizations/organization-context.js';
import type { AllocatePaymentMadeDto, CreatePaymentMadeDto } from './payments-made.dto.js';

type PaymentMadeWithAllocations = Prisma.PaymentMadeGetPayload<{
  include: typeof paymentDetailInclude;
}>;

const paymentDetailInclude = {
  allocations: {
    include: { bill: { select: { id: true, billNumber: true } } },
  },
  vendor: { select: { id: true, displayName: true, currency: true, payableAccountId: true } },
} satisfies Prisma.PaymentMadeInclude;

const OPEN_BILL_STATUSES = ['ISSUED', 'PARTIALLY_PAID'] as const;

/**
 * Payable-side mirror of PaymentsService: `record()` posts once at recording time (AP debit vs
 * cash/bank credit), no draft state; `allocate()` applies the recorded payment against open bills
 * with the same money-invariant-critical lock order and guard shape as `PaymentsService#allocate`.
 */
@Injectable()
export class PaymentsMadeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly numbering: DocumentNumberingService,
  ) {}

  async list(organizationId: string, status?: string) {
    const payments = await this.prisma.paymentMade.findMany({
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

  async openBillsFor(organizationId: string, paymentId: string) {
    const payment = await this.findOrThrow(organizationId, paymentId);
    const bills = await this.prisma.bill.findMany({
      where: {
        organizationId,
        vendorId: payment.vendorId,
        status: { in: [...OPEN_BILL_STATUSES] },
        balanceMinor: { gt: 0n },
      },
      orderBy: [{ issueDate: 'asc' }],
      select: {
        id: true,
        billNumber: true,
        issueDate: true,
        dueDate: true,
        currency: true,
        totalMinor: true,
        paidMinor: true,
        balanceMinor: true,
      },
    });
    return bills.map((bill) => ({
      id: bill.id,
      billNumber: bill.billNumber,
      issueDate: bill.issueDate ? dateOnly(bill.issueDate) : null,
      dueDate: bill.dueDate ? dateOnly(bill.dueDate) : null,
      currency: bill.currency,
      totalMinor: bill.totalMinor.toString(),
      paidMinor: bill.paidMinor.toString(),
      balanceMinor: bill.balanceMinor.toString(),
    }));
  }

  async record(
    context: OrganizationContext,
    user: PublicUser,
    input: CreatePaymentMadeDto,
    metadata: RequestMetadata,
    idempotencyKey?: string,
  ) {
    const vendor = await this.prisma.vendor.findFirst({
      where: { id: input.vendorId, organizationId: context.id },
    });
    if (!vendor) throw new NotFoundException('Vendor not found.');
    if (vendor.status !== 'ACTIVE') {
      throw new ConflictException('Cannot record a payment for a deactivated vendor.');
    }
    const currency = input.currency ?? vendor.currency;
    const amountMinor = BigInt(input.amountMinor);
    if (amountMinor <= 0n) {
      throw new BadRequestException('A payment amount must be greater than zero.');
    }
    const paidDate = isoDate(input.paidDate);

    const recorded = await this.prisma.$transaction(async (tx) => {
      await this.lockPaymentIdempotency(tx, context.id, 'PAYMENT_MADE_RECORD', idempotencyKey);
      const existingResult = await this.findPaymentIdempotentResult(
        context.id,
        'PAYMENT_MADE_RECORD',
        idempotencyKey,
        tx,
      );
      if (existingResult) {
        return tx.paymentMade.findFirstOrThrow({
          where: { id: existingResult.resourceId, organizationId: context.id },
          include: paymentDetailInclude,
        });
      }

      const paidFromAccount = await this.ledger.accountBySystemKey(context.id, 'bank_default', tx);
      const apAccount = vendor.payableAccountId
        ? await tx.ledgerAccount.findUniqueOrThrow({ where: { id: vendor.payableAccountId } })
        : await this.ledger.accountBySystemKey(context.id, 'accounts_payable', tx);

      const payment = await tx.paymentMade.create({
        data: {
          organizationId: context.id,
          vendorId: vendor.id,
          status: 'UNAPPLIED',
          paidDate,
          currency,
          amountMinor,
          allocatedMinor: 0n,
          unappliedMinor: amountMinor,
          paidFromAccountId: paidFromAccount.id,
          createdByUserId: user.id,
        },
      });

      const postedJournal = await this.ledger.postJournalFromLines(
        context,
        user,
        'PAYMENT_MADE_RECORD',
        {
          journalDate: paidDate,
          currency,
          description: `Payment to ${vendor.displayName}`,
          sourceType: 'PAYMENT_MADE',
          sourceId: payment.id,
          lines: [
            {
              accountId: apAccount.id,
              debitMinor: amountMinor,
              creditMinor: 0n,
              description: `Payment to ${vendor.displayName}`,
            },
            {
              accountId: paidFromAccount.id,
              debitMinor: 0n,
              creditMinor: amountMinor,
              description: `Payment to ${vendor.displayName}`,
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
        PAYMENT_MADE_DOCUMENT_TYPE,
        paidDate,
      );

      const updated = await tx.paymentMade.update({
        where: { id: payment.id },
        data: { paymentNumber: allocation.value, journalId: postedJournal.id },
        include: paymentDetailInclude,
      });

      await this.recordPaymentIdempotency(
        tx,
        context.id,
        'PAYMENT_MADE_RECORD',
        idempotencyKey,
        payment.id,
      );
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'purchases.payment_made_recorded',
        entityType: 'payment_made',
        entityId: payment.id,
        action: AuditAction.CREATE,
        after: { vendorId: vendor.id, amountMinor: amountMinor.toString() },
        ipHash: metadata.ipHash,
      });

      return updated;
    });

    return summarizePayment(recorded);
  }

  /**
   * Applies a recorded payment against one or more of the vendor's open bills. Mirrors
   * `PaymentsService#allocate` exactly: fixed lock order (payment row, then bill rows ascending by
   * id), both invariants (whole-call total vs `payment.unappliedMinor`, and each bill's requested
   * amount vs the freshly re-read `bill.balanceMinor` -- never re-adding this payment's own prior
   * allocations) checked before any write. No new journal per allocation; cash already landed in
   * `record()`.
   */
  async allocate(
    context: OrganizationContext,
    user: PublicUser,
    paymentId: string,
    input: AllocatePaymentMadeDto,
    metadata: RequestMetadata,
    idempotencyKey?: string,
  ) {
    const requestedByBill = new Map<string, bigint>();
    for (const line of input.allocations) {
      if (requestedByBill.has(line.billId)) {
        throw new BadRequestException(
          `Bill ${line.billId} appears more than once in this allocation request.`,
        );
      }
      const amount = BigInt(line.amountMinor);
      if (amount <= 0n) {
        throw new BadRequestException('Each allocation amount must be greater than zero.');
      }
      requestedByBill.set(line.billId, amount);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.lockPaymentIdempotency(tx, context.id, 'PAYMENT_MADE_ALLOCATE', idempotencyKey);
      const existingResult = await this.findPaymentIdempotentResult(
        context.id,
        'PAYMENT_MADE_ALLOCATE',
        idempotencyKey,
        tx,
      );
      if (existingResult) {
        return tx.paymentMade.findFirstOrThrow({
          where: { id: existingResult.resourceId, organizationId: context.id },
          include: paymentDetailInclude,
        });
      }

      // Lock order, fixed for all time: payment row first, then bill rows ascending by id.
      await this.lockPaymentRow(tx, context.id, paymentId);
      const payment = await tx.paymentMade.findFirst({
        where: { id: paymentId, organizationId: context.id },
      });
      if (!payment) throw new NotFoundException('Payment not found.');

      const sortedBillIds = [...requestedByBill.keys()].sort();
      await this.lockBillRowsInOrder(tx, context.id, sortedBillIds);
      const bills = await tx.bill.findMany({
        where: { id: { in: sortedBillIds }, organizationId: context.id },
      });
      const billsById = new Map(bills.map((bill) => [bill.id, bill]));
      for (const billId of sortedBillIds) {
        const bill = billsById.get(billId);
        if (!bill) throw new NotFoundException(`Bill ${billId} not found.`);
        if (bill.vendorId !== payment.vendorId) {
          throw new ConflictException(`Bill ${billId} does not belong to this payment's vendor.`);
        }
        if (bill.status !== 'ISSUED' && bill.status !== 'PARTIALLY_PAID') {
          throw new ConflictException(`Bill ${billId} is not open for allocation.`);
        }
      }

      const totalRequestedMinor = [...requestedByBill.values()].reduce(
        (sum, amount) => sum + amount,
        0n,
      );
      if (totalRequestedMinor > payment.unappliedMinor) {
        throw new ConflictException("Allocation total exceeds the payment's unapplied amount.");
      }

      for (const [billId, amount] of requestedByBill) {
        const bill = billsById.get(billId)!;
        if (amount > bill.balanceMinor) {
          throw new ConflictException(
            `Allocation for bill ${billId} exceeds its remaining balance.`,
          );
        }
      }

      for (const [billId, amount] of requestedByBill) {
        const bill = billsById.get(billId)!;
        await tx.paymentMadeAllocation.upsert({
          where: { paymentId_billId: { paymentId, billId } },
          create: { organizationId: context.id, paymentId, billId, amountMinor: amount },
          update: { amountMinor: { increment: amount } },
        });
        const newBalanceMinor = bill.balanceMinor - amount;
        await tx.bill.update({
          where: { id: billId },
          data: {
            paidMinor: bill.paidMinor + amount,
            balanceMinor: newBalanceMinor,
            status: newBalanceMinor === 0n ? 'PAID' : 'PARTIALLY_PAID',
          },
        });
      }

      const newAllocatedMinor = payment.allocatedMinor + totalRequestedMinor;
      const newUnappliedMinor = payment.unappliedMinor - totalRequestedMinor;
      const updatedPayment = await tx.paymentMade.update({
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
        'PAYMENT_MADE_ALLOCATE',
        idempotencyKey,
        paymentId,
      );
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'purchases.payment_made_allocated',
        entityType: 'payment_made',
        entityId: paymentId,
        action: AuditAction.UPDATE,
        after: { totalRequestedMinor: totalRequestedMinor.toString(), billIds: sortedBillIds },
        ipHash: metadata.ipHash,
      });

      return updatedPayment;
    });

    return summarizePayment(updated);
  }

  private async findOrThrow(organizationId: string, paymentId: string) {
    const payment = await this.prisma.paymentMade.findFirst({
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
        resourceType: 'PAYMENT_MADE',
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
      FROM payments_made
      WHERE id = ${paymentId}::uuid AND organization_id = ${organizationId}::uuid
      FOR UPDATE
    `;
  }

  private async lockBillRowsInOrder(
    tx: Prisma.TransactionClient,
    organizationId: string,
    billIds: readonly string[],
  ): Promise<void> {
    if (billIds.length === 0) return;
    await tx.$queryRaw`
      SELECT id
      FROM bills
      WHERE id = ANY(${billIds}::uuid[]) AND organization_id = ${organizationId}::uuid
      ORDER BY id
      FOR UPDATE
    `;
  }
}

function summarizePayment(payment: PaymentMadeWithAllocations) {
  return {
    id: payment.id,
    vendorId: payment.vendorId,
    vendorName: payment.vendor.displayName,
    paymentNumber: payment.paymentNumber,
    status: payment.status,
    paidDate: dateOnly(payment.paidDate),
    currency: payment.currency,
    amountMinor: payment.amountMinor.toString(),
    allocatedMinor: payment.allocatedMinor.toString(),
    unappliedMinor: payment.unappliedMinor.toString(),
    paidFromAccountId: payment.paidFromAccountId,
    journalId: payment.journalId,
    allocations: payment.allocations.map((allocation) => ({
      id: allocation.id,
      paymentId: allocation.paymentId,
      billId: allocation.billId,
      billNumber: allocation.bill.billNumber,
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
