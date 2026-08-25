import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import type { GetStatementQueryDto } from './statements.dto.js';

type StatementTransactionType =
  | 'INVOICE_ISSUED'
  | 'PAYMENT_RECEIVED'
  | 'PAYMENT_ALLOCATED'
  | 'CREDIT_NOTE_ISSUED'
  | 'CREDIT_NOTE_ALLOCATED'
  | 'CREDIT_NOTE_REFUNDED';

interface StatementEvent {
  id: string;
  type: StatementTransactionType;
  occurredAt: Date;
  invoiceId: string | null;
  invoiceNumber: string | null;
  paymentId: string | null;
  paymentNumber: string | null;
  creditNoteId: string | null;
  creditNoteNumber: string | null;
  /** Signed change to the contact's AR balance this event causes; `0n` for informational events. */
  arDeltaMinor: bigint;
}

/**
 * Derives a customer statement entirely by replaying the same three events that
 * `InvoicesService#issueInvoice`, `PaymentsService#allocate`, and `CreditNotesService#allocate`
 * already use to maintain `Invoice.balanceMinor` incrementally (+totalMinor at issue, -amountMinor
 * per payment allocation, -amountMinor per credit-note allocation). Replaying exactly these deltas,
 * and nothing else, guarantees the closing balance reconciles to `sum(Invoice.balanceMinor)` for the
 * contact by construction -- the same lesson as the 2E allocation-invariant bug: never recompute a
 * balance independently from raw postings when the authoritative field is already maintained
 * incrementally by the same events.
 *
 * Three more event types (payment received, credit note issued, credit note refunded) are included
 * in the transaction list for context but never move the AR balance -- they post into the deposit
 * account or the `customer_credit` liability account, not into `accounts_receivable` (see the doc
 * comment at the top of `credit-notes.service.ts`).
 *
 * Note `InvoicesService#voidInvoice` never resets `balanceMinor` (voiding is only allowed while
 * `paidMinor === 0n`, i.e. `balanceMinor` still equals `totalMinor`), so a voided invoice keeps
 * contributing its full total to the statement forever. This is a pre-existing quirk in the domain
 * model, faithfully mirrored here rather than "fixed" -- fixing it here would break exact
 * reconciliation to `Invoice.balanceMinor`.
 */
@Injectable()
export class StatementsService {
  constructor(private readonly prisma: PrismaService) {}

  async getStatement(organizationId: string, contactId: string, query: GetStatementQueryDto) {
    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, organizationId, type: 'CUSTOMER' },
      select: { id: true, displayName: true, currency: true },
    });
    if (!contact) throw new NotFoundException('Customer not found.');

    const invoices = await this.prisma.invoice.findMany({
      where: { organizationId, contactId, issueDate: { not: null } },
      select: { id: true, invoiceNumber: true, issueDate: true, totalMinor: true },
    });
    const invoiceIds = invoices.map((invoice) => invoice.id);

    const [paymentAllocations, creditNoteAllocations, payments, creditNotes] = await Promise.all([
      invoiceIds.length === 0
        ? Promise.resolve([])
        : this.prisma.paymentAllocation.findMany({
            where: { organizationId, invoiceId: { in: invoiceIds } },
            include: {
              payment: { select: { id: true, paymentNumber: true } },
              invoice: { select: { invoiceNumber: true } },
            },
          }),
      invoiceIds.length === 0
        ? Promise.resolve([])
        : this.prisma.creditNoteAllocation.findMany({
            where: { organizationId, invoiceId: { in: invoiceIds } },
            include: {
              creditNote: { select: { id: true, creditNoteNumber: true } },
              invoice: { select: { invoiceNumber: true } },
            },
          }),
      this.prisma.paymentReceived.findMany({
        where: { organizationId, contactId },
        select: { id: true, paymentNumber: true, receivedDate: true },
      }),
      this.prisma.creditNote.findMany({
        where: { organizationId, contactId, issueDate: { not: null } },
        select: { id: true, creditNoteNumber: true, issueDate: true },
      }),
    ]);

    const creditNoteIds = creditNotes.map((creditNote) => creditNote.id);
    const creditNoteRefunds =
      creditNoteIds.length === 0
        ? []
        : await this.prisma.creditNoteRefund.findMany({
            where: { organizationId, creditNoteId: { in: creditNoteIds } },
          });
    const creditNoteNumberById = new Map(
      creditNotes.map((creditNote) => [creditNote.id, creditNote.creditNoteNumber]),
    );

    const events: StatementEvent[] = [
      ...invoices.map((invoice): StatementEvent => ({
        id: invoice.id,
        type: 'INVOICE_ISSUED',
        occurredAt: invoice.issueDate!,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        paymentId: null,
        paymentNumber: null,
        creditNoteId: null,
        creditNoteNumber: null,
        arDeltaMinor: invoice.totalMinor,
      })),
      ...paymentAllocations.map((allocation): StatementEvent => ({
        id: allocation.id,
        type: 'PAYMENT_ALLOCATED',
        occurredAt: allocation.createdAt,
        invoiceId: allocation.invoiceId,
        invoiceNumber: allocation.invoice.invoiceNumber,
        paymentId: allocation.paymentId,
        paymentNumber: allocation.payment.paymentNumber,
        creditNoteId: null,
        creditNoteNumber: null,
        arDeltaMinor: -allocation.amountMinor,
      })),
      ...creditNoteAllocations.map((allocation): StatementEvent => ({
        id: allocation.id,
        type: 'CREDIT_NOTE_ALLOCATED',
        occurredAt: allocation.createdAt,
        invoiceId: allocation.invoiceId,
        invoiceNumber: allocation.invoice.invoiceNumber,
        paymentId: null,
        paymentNumber: null,
        creditNoteId: allocation.creditNoteId,
        creditNoteNumber: allocation.creditNote.creditNoteNumber,
        arDeltaMinor: -allocation.amountMinor,
      })),
      ...payments.map((payment): StatementEvent => ({
        id: payment.id,
        type: 'PAYMENT_RECEIVED',
        occurredAt: payment.receivedDate,
        invoiceId: null,
        invoiceNumber: null,
        paymentId: payment.id,
        paymentNumber: payment.paymentNumber,
        creditNoteId: null,
        creditNoteNumber: null,
        arDeltaMinor: 0n,
      })),
      ...creditNotes.map((creditNote): StatementEvent => ({
        id: creditNote.id,
        type: 'CREDIT_NOTE_ISSUED',
        occurredAt: creditNote.issueDate!,
        invoiceId: null,
        invoiceNumber: null,
        paymentId: null,
        paymentNumber: null,
        creditNoteId: creditNote.id,
        creditNoteNumber: creditNote.creditNoteNumber,
        arDeltaMinor: 0n,
      })),
      ...creditNoteRefunds.map((refund): StatementEvent => ({
        id: refund.id,
        type: 'CREDIT_NOTE_REFUNDED',
        occurredAt: refund.createdAt,
        invoiceId: null,
        invoiceNumber: null,
        paymentId: null,
        paymentNumber: null,
        creditNoteId: refund.creditNoteId,
        creditNoteNumber: creditNoteNumberById.get(refund.creditNoteId) ?? null,
        arDeltaMinor: 0n,
      })),
    ];

    events.sort((a, b) => {
      const byDate = a.occurredAt.getTime() - b.occurredAt.getTime();
      return byDate !== 0 ? byDate : a.id.localeCompare(b.id);
    });

    const from = query.from ?? null;
    const to = query.to ?? dateOnly(new Date());
    const fromBoundary = from ? isoDate(from) : null;
    const toBoundaryExclusive = isoDateExclusiveEnd(to);

    let openingBalanceMinor = 0n;
    if (fromBoundary) {
      for (const event of events) {
        if (event.occurredAt < fromBoundary) openingBalanceMinor += event.arDeltaMinor;
      }
    }

    let running = openingBalanceMinor;
    let invoicedMinor = 0n;
    let paymentsAllocatedMinor = 0n;
    let creditNotesAllocatedMinor = 0n;
    const transactions = [];

    for (const event of events) {
      if (fromBoundary && event.occurredAt < fromBoundary) continue;
      if (event.occurredAt >= toBoundaryExclusive) continue;

      running += event.arDeltaMinor;
      if (event.type === 'INVOICE_ISSUED') invoicedMinor += event.arDeltaMinor;
      if (event.type === 'PAYMENT_ALLOCATED') paymentsAllocatedMinor += -event.arDeltaMinor;
      if (event.type === 'CREDIT_NOTE_ALLOCATED') creditNotesAllocatedMinor += -event.arDeltaMinor;

      transactions.push({
        id: event.id,
        type: event.type,
        date: dateOnly(event.occurredAt),
        description: describeEvent(event),
        invoiceId: event.invoiceId,
        invoiceNumber: event.invoiceNumber,
        paymentId: event.paymentId,
        paymentNumber: event.paymentNumber,
        creditNoteId: event.creditNoteId,
        creditNoteNumber: event.creditNoteNumber,
        debitMinor: event.arDeltaMinor > 0n ? event.arDeltaMinor.toString() : '0',
        creditMinor: event.arDeltaMinor < 0n ? (-event.arDeltaMinor).toString() : '0',
        balanceMinor: running.toString(),
      });
    }

    return {
      contact,
      from,
      to,
      summary: {
        openingBalanceMinor: openingBalanceMinor.toString(),
        closingBalanceMinor: running.toString(),
        invoicedMinor: invoicedMinor.toString(),
        paymentsAllocatedMinor: paymentsAllocatedMinor.toString(),
        creditNotesAllocatedMinor: creditNotesAllocatedMinor.toString(),
      },
      transactions,
    };
  }
}

function describeEvent(event: StatementEvent): string {
  switch (event.type) {
    case 'INVOICE_ISSUED':
      return `Invoice ${event.invoiceNumber ?? event.invoiceId} issued`;
    case 'PAYMENT_RECEIVED':
      return `Payment ${event.paymentNumber ?? event.paymentId} received`;
    case 'PAYMENT_ALLOCATED':
      return `Payment ${event.paymentNumber ?? event.paymentId} applied to invoice ${event.invoiceNumber ?? event.invoiceId}`;
    case 'CREDIT_NOTE_ISSUED':
      return `Credit note ${event.creditNoteNumber ?? event.creditNoteId} issued`;
    case 'CREDIT_NOTE_ALLOCATED':
      return `Credit note ${event.creditNoteNumber ?? event.creditNoteId} applied to invoice ${event.invoiceNumber ?? event.invoiceId}`;
    case 'CREDIT_NOTE_REFUNDED':
      return `Credit note ${event.creditNoteNumber ?? event.creditNoteId} refunded`;
  }
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isoDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}

function isoDateExclusiveEnd(value: string): Date {
  return new Date(isoDate(value).getTime() + 86_400_000);
}
