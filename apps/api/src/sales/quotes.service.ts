import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, type Prisma, type QuoteStatus } from '@prisma/client';
import { roundHalfUpDivide } from '@retailbooks/accounting-core';

import type { PublicUser } from '../auth/auth.service.js';
import type { RequestMetadata } from '../auth/request-context.js';
import { assertNoPendingApproval } from '../automation/approval-targets.js';
import { PrismaService } from '../database/prisma.service.js';
import { EMAIL_JOB_NAMES } from '../jobs/email-job.js';
import { EmailQueueService } from '../jobs/email-queue.service.js';
import { writeAuditEvent } from '../organizations/audit-event.js';
import { QUOTE_DOCUMENT_TYPE } from '../organizations/document-numbering.js';
import { DocumentNumberingService } from '../organizations/document-numbering.service.js';
import type { OrganizationContext } from '../organizations/organization-context.js';
import { DocumentRenderingService } from './document-rendering.service.js';
import { InvoicesService } from './invoices.service.js';
import { buildPdfRenderSnapshot, parsePdfRenderSnapshot } from './pdf-render-snapshot.js';
import { renderQuoteHtml } from './pdf-templates.js';
import type { CreateQuoteDto, QuoteLineDto, UpdateQuoteDto } from './quotes.dto.js';

const QUANTITY_SCALE = 10_000n;

type QuoteWithLines = Prisma.QuoteGetPayload<{ include: typeof quoteDetailInclude }>;

const quoteDetailInclude = {
  lines: { orderBy: { lineNumber: 'asc' } },
  contact: { select: { id: true, displayName: true, currency: true, email: true } },
} satisfies Prisma.QuoteInclude;

@Injectable()
export class QuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: DocumentNumberingService,
    private readonly invoices: InvoicesService,
    private readonly documentRendering: DocumentRenderingService,
    private readonly emailQueue: EmailQueueService,
  ) {}

  async list(organizationId: string, status?: string) {
    const quotes = await this.prisma.quote.findMany({
      where: { organizationId, ...(status ? { status: status as never } : {}) },
      orderBy: [{ createdAt: 'desc' }],
      include: quoteDetailInclude,
      take: 200,
    });
    return quotes.map(summarizeQuote);
  }

  async detail(organizationId: string, quoteId: string) {
    const quote = await this.findOrThrow(organizationId, quoteId);
    return summarizeQuote(quote);
  }

  async createDraft(
    context: OrganizationContext,
    user: PublicUser,
    input: CreateQuoteDto,
    metadata: RequestMetadata,
  ) {
    const contact = await this.prisma.contact.findFirst({
      where: { id: input.contactId, organizationId: context.id, type: 'CUSTOMER' },
    });
    if (!contact) throw new NotFoundException('Customer not found.');
    if (contact.status !== 'ACTIVE') {
      throw new ConflictException('Cannot quote a deactivated customer.');
    }
    const currency = input.currency ?? contact.currency;
    const resolvedLines = await this.resolveLines(context.id, input.lines);
    const totalMinor = resolvedLines.reduce((sum, line) => sum + line.lineTotalMinor, 0n);

    const created = await this.prisma.$transaction(async (tx) => {
      const quote = await tx.quote.create({
        data: {
          organizationId: context.id,
          contactId: contact.id,
          currency,
          expiryDate: input.expiryDate ? isoDate(input.expiryDate) : null,
          subtotalMinor: totalMinor,
          totalMinor,
          createdByUserId: user.id,
          lines: {
            create: resolvedLines.map((line, index) => lineCreateData(line, index, context.id)),
          },
        },
        include: quoteDetailInclude,
      });

      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'sales.quote_created',
        entityType: 'quote',
        entityId: quote.id,
        action: AuditAction.CREATE,
        after: { contactId: contact.id, totalMinor: totalMinor.toString() },
        ipHash: metadata.ipHash,
      });

      return quote;
    });

    return summarizeQuote(created);
  }

  async updateDraft(
    context: OrganizationContext,
    user: PublicUser,
    quoteId: string,
    input: UpdateQuoteDto,
    metadata: RequestMetadata,
  ) {
    const existing = await this.findOrThrow(context.id, quoteId);
    if (existing.status !== 'DRAFT') {
      throw new ConflictException('Only draft quotes can be edited.');
    }

    let contact = existing.contact;
    if (input.contactId && input.contactId !== existing.contactId) {
      const nextContact = await this.prisma.contact.findFirst({
        where: { id: input.contactId, organizationId: context.id, type: 'CUSTOMER' },
      });
      if (!nextContact) throw new NotFoundException('Customer not found.');
      if (nextContact.status !== 'ACTIVE') {
        throw new ConflictException('Cannot quote a deactivated customer.');
      }
      contact = {
        id: nextContact.id,
        displayName: nextContact.displayName,
        currency: nextContact.currency,
        email: nextContact.email,
      };
    }

    const currency = input.currency ?? contact.currency;
    const resolvedLines = input.lines ? await this.resolveLines(context.id, input.lines) : null;
    const totalMinor = resolvedLines
      ? resolvedLines.reduce((sum, line) => sum + line.lineTotalMinor, 0n)
      : existing.totalMinor;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (resolvedLines) {
        await tx.quoteLine.deleteMany({ where: { quoteId } });
      }
      const quote = await tx.quote.update({
        where: { id: quoteId, ...(input.version !== undefined ? { version: input.version } : {}) },
        data: {
          contactId: contact.id,
          currency,
          expiryDate:
            input.expiryDate !== undefined ? isoDate(input.expiryDate) : existing.expiryDate,
          subtotalMinor: totalMinor,
          totalMinor,
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
        include: quoteDetailInclude,
      });

      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'sales.quote_updated',
        entityType: 'quote',
        entityId: quoteId,
        action: AuditAction.UPDATE,
        before: { totalMinor: existing.totalMinor.toString() },
        after: { totalMinor: totalMinor.toString() },
        ipHash: metadata.ipHash,
      });

      return quote;
    });

    return summarizeQuote(updated);
  }

  /** DRAFT -> PENDING_APPROVAL. Allocates the quote's number here -- the first point it leaves an
   * internal-only state, mirroring how an Invoice's number is allocated at Issue, not at draft
   * creation. */
  async submitForApproval(
    context: OrganizationContext,
    user: PublicUser,
    quoteId: string,
    metadata: RequestMetadata,
  ) {
    const existing = await this.findOrThrow(context.id, quoteId);
    if (existing.status !== 'DRAFT') {
      throw new ConflictException('Only draft quotes can be submitted for approval.');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const allocation = await this.numbering.allocateDocumentNumberWithClient(
        tx,
        context.id,
        QUOTE_DOCUMENT_TYPE,
        new Date(),
      );
      const quote = await tx.quote.update({
        where: { id: quoteId },
        data: {
          status: 'PENDING_APPROVAL',
          quoteNumber: allocation.value,
          issueDate: isoDate(dateOnly(new Date())),
        },
        include: quoteDetailInclude,
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'sales.quote_submitted',
        entityType: 'quote',
        entityId: quoteId,
        action: AuditAction.UPDATE,
        before: { status: 'DRAFT' },
        after: { status: 'PENDING_APPROVAL', quoteNumber: allocation.value },
        ipHash: metadata.ipHash,
      });
      return quote;
    });
    return summarizeQuote(updated);
  }

  approve(
    context: OrganizationContext,
    user: PublicUser,
    quoteId: string,
    metadata: RequestMetadata,
  ) {
    return this.transition(context, user, quoteId, metadata, {
      from: ['PENDING_APPROVAL'],
      to: 'APPROVED',
      eventKey: 'sales.quote_approved',
      errorMessage: 'Only quotes pending approval can be approved.',
      // APPROVED is the first state where the quote's data is frozen (edits are only allowed in
      // DRAFT), so this is where the PDF render payload is captured -- once approved, no later
      // customer rename or org restyle may restate the sent document (GAPS #38).
      onUpdated: async (tx, quote) => {
        await tx.quote.update({
          where: { id: quoteId },
          data: {
            pdfSnapshot: buildPdfRenderSnapshot({
              organizationName: context.legalName,
              contactName: quote.contact.displayName,
              number: quote.quoteNumber,
              issueDate: quote.issueDate ? dateOnly(quote.issueDate) : null,
              currency: quote.currency,
              subtotalMinor: quote.subtotalMinor.toString(),
              totalMinor: quote.totalMinor.toString(),
              lines: quote.lines.map((line) => ({
                descriptionSnapshot: line.descriptionSnapshot,
                quantity: line.quantity,
                unitPriceMinor: line.unitPriceMinor,
                discountMinor: line.discountMinor,
                lineTotalMinor: line.lineTotalMinor,
              })),
            }),
          },
        });
      },
    });
  }

  /** Unlike the other transitions, this doesn't delegate to the shared `transition()` helper: sending
   * a quote also renders it to PDF (cached -- a re-send never re-renders) and enqueues an email job,
   * in addition to the APPROVED -> SENT status flip and setting `sentAt`. */
  async send(
    context: OrganizationContext,
    user: PublicUser,
    quoteId: string,
    metadata: RequestMetadata,
  ) {
    const existing = await this.findOrThrow(context.id, quoteId);
    // APPROVED is the first-send transition; SENT is allowed too so a quote can be re-sent (e.g. the
    // customer asks for another copy) without needing a second, separate "resend" action.
    if (existing.status !== 'APPROVED' && existing.status !== 'SENT') {
      throw new ConflictException('Only approved or already-sent quotes can be sent.');
    }
    if (!existing.contact.email) {
      throw new BadRequestException('This customer has no email address on file.');
    }

    // The PDF always renders from the frozen `pdfSnapshot` captured at approval time (GAPS #38) --
    // never from the live `context.legalName`/`contact.displayName`. Legacy rows fall back unchanged.
    const snapshot = parsePdfRenderSnapshot(existing.pdfSnapshot);
    const html = snapshot
      ? renderQuoteHtml(snapshot.organizationName, {
          quoteNumber: snapshot.number,
          contactName: snapshot.contactName,
          issueDate: snapshot.issueDate,
          currency: snapshot.currency,
          subtotalMinor: snapshot.subtotalMinor,
          totalMinor: snapshot.totalMinor,
          lines: snapshot.lines,
        })
      : renderQuoteHtml(context.legalName, {
          quoteNumber: existing.quoteNumber,
          contactName: existing.contact.displayName,
          issueDate: existing.issueDate ? dateOnly(existing.issueDate) : null,
          currency: existing.currency,
          subtotalMinor: existing.subtotalMinor.toString(),
          totalMinor: existing.totalMinor.toString(),
          lines: existing.lines.map((line) => ({
            descriptionSnapshot: line.descriptionSnapshot,
            quantity: line.quantity.toString(),
            unitPriceMinor: line.unitPriceMinor.toString(),
            discountMinor: line.discountMinor.toString(),
            lineTotalMinor: line.lineTotalMinor.toString(),
          })),
        });
    const { storageKey } = await this.documentRendering.render(context.id, 'QUOTE', quoteId, html);
    const signedUrl = await this.documentRendering.getSignedUrl(storageKey);

    await this.emailQueue.enqueue(EMAIL_JOB_NAMES.quoteSend, {
      to: existing.contact.email,
      subject: `Quote ${existing.quoteNumber ?? ''} from ${context.legalName}`,
      text: `Please find attached quote ${existing.quoteNumber ?? ''} from ${context.legalName}.`,
      html: `<p>Please find attached quote ${existing.quoteNumber ?? ''} from ${context.legalName}.</p>`,
      attachments: [{ filename: `${existing.quoteNumber ?? quoteId}.pdf`, path: signedUrl }],
    });

    const updated = await this.prisma.$transaction(async (tx) => {
      const quote = await tx.quote.update({
        where: { id: quoteId },
        data: { status: 'SENT', sentAt: new Date() },
        include: quoteDetailInclude,
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'sales.quote_sent',
        entityType: 'quote',
        entityId: quoteId,
        action: AuditAction.UPDATE,
        before: { status: existing.status },
        after: { status: 'SENT', sentAt: quote.sentAt!.toISOString() },
        ipHash: metadata.ipHash,
      });
      return quote;
    });

    return summarizeQuote(updated);
  }

  accept(
    context: OrganizationContext,
    user: PublicUser,
    quoteId: string,
    metadata: RequestMetadata,
  ) {
    return this.transition(context, user, quoteId, metadata, {
      from: ['SENT'],
      to: 'ACCEPTED',
      eventKey: 'sales.quote_accepted',
      errorMessage: 'Only sent quotes can be accepted.',
    });
  }

  decline(
    context: OrganizationContext,
    user: PublicUser,
    quoteId: string,
    metadata: RequestMetadata,
  ) {
    return this.transition(context, user, quoteId, metadata, {
      from: ['SENT'],
      to: 'DECLINED',
      eventKey: 'sales.quote_declined',
      errorMessage: 'Only sent quotes can be declined.',
    });
  }

  expire(
    context: OrganizationContext,
    user: PublicUser,
    quoteId: string,
    metadata: RequestMetadata,
  ) {
    return this.transition(context, user, quoteId, metadata, {
      from: ['SENT'],
      to: 'EXPIRED',
      eventKey: 'sales.quote_expired',
      errorMessage: 'Only sent quotes can be marked expired.',
    });
  }

  /** Re-snapshots this quote's lines into a new DRAFT invoice via `InvoicesService#createDraft`
   * (2D's path), then links it. The invoice creation and the quote-status update are two separate
   * transactions -- acceptable because the worst-case failure mode is an unlinked DRAFT invoice, not
   * a ledger inconsistency (nothing here ever posts). */
  async convertToInvoice(
    context: OrganizationContext,
    user: PublicUser,
    quoteId: string,
    metadata: RequestMetadata,
  ) {
    const existing = await this.findOrThrow(context.id, quoteId);
    if (existing.status !== 'ACCEPTED') {
      throw new ConflictException('Only accepted quotes can be converted to an invoice.');
    }
    await assertNoPendingApproval(this.prisma, context.id, 'QUOTE', quoteId);

    const invoice = await this.invoices.createDraft(
      context,
      user,
      {
        contactId: existing.contactId,
        currency: existing.currency,
        lines: existing.lines.map((line) => ({
          itemId: line.itemId ?? undefined,
          description: line.itemId ? undefined : line.descriptionSnapshot,
          quantity: line.quantity.toString(),
          unitPriceMinor: line.unitPriceMinor.toString(),
          discountMinor: line.discountMinor.toString(),
          taxCodeId: line.taxCodeId ?? undefined,
          warehouseId: line.warehouseId ?? undefined,
        })),
      },
      metadata,
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      const quote = await tx.quote.update({
        where: { id: quoteId },
        data: { status: 'CONVERTED', convertedInvoiceId: invoice.id },
        include: quoteDetailInclude,
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'sales.quote_converted',
        entityType: 'quote',
        entityId: quoteId,
        action: AuditAction.UPDATE,
        before: { status: 'ACCEPTED' },
        after: { status: 'CONVERTED', convertedInvoiceId: invoice.id },
        ipHash: metadata.ipHash,
      });
      return quote;
    });

    return summarizeQuote(updated);
  }

  private async transition(
    context: OrganizationContext,
    user: PublicUser,
    quoteId: string,
    metadata: RequestMetadata,
    options: {
      from: readonly QuoteStatus[];
      to: QuoteStatus;
      eventKey: string;
      errorMessage: string;
      /** Runs inside the same transaction after the status update, e.g. to freeze a render payload. */
      onUpdated?: (tx: Prisma.TransactionClient, quote: QuoteWithLines) => Promise<void>;
    },
  ) {
    const existing = await this.findOrThrow(context.id, quoteId);
    if (!options.from.includes(existing.status)) {
      throw new ConflictException(options.errorMessage);
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const quote = await tx.quote.update({
        where: { id: quoteId },
        data: { status: options.to },
        include: quoteDetailInclude,
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: options.eventKey,
        entityType: 'quote',
        entityId: quoteId,
        action: AuditAction.UPDATE,
        before: { status: existing.status },
        after: { status: options.to },
        ipHash: metadata.ipHash,
      });
      if (options.onUpdated) await options.onUpdated(tx, quote);
      return quote;
    });
    return summarizeQuote(updated);
  }

  private async findOrThrow(organizationId: string, quoteId: string) {
    const quote = await this.prisma.quote.findFirst({
      where: { id: quoteId, organizationId },
      include: quoteDetailInclude,
    });
    if (!quote) throw new NotFoundException('Quote not found.');
    return quote;
  }

  private async resolveLines(organizationId: string, lines: readonly QuoteLineDto[]) {
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
        : resolveDefaultPrice(item, label);

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
        warehouseId: line.warehouseId ?? null,
      };
    });
  }
}

function resolveDefaultPrice(
  item: Prisma.ItemGetPayload<{ include: { prices: true } }> | undefined,
  label: string,
): bigint {
  const price = item?.prices.find((candidate) => candidate.priceListKey === 'default');
  if (!price) {
    throw new BadRequestException(`${label}: no unit price given and no default price found.`);
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

function lineCreateData(
  line: {
    itemId: string | null;
    descriptionSnapshot: string;
    quantity: string;
    unitPriceMinor: bigint;
    discountMinor: bigint;
    lineTotalMinor: bigint;
    taxCodeId: string | null;
    warehouseId: string | null;
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
    warehouseId: line.warehouseId,
  };
}

function summarizeQuote(quote: QuoteWithLines) {
  return {
    id: quote.id,
    contactId: quote.contactId,
    contactName: quote.contact.displayName,
    quoteNumber: quote.quoteNumber,
    status: quote.status,
    issueDate: quote.issueDate ? dateOnly(quote.issueDate) : null,
    expiryDate: quote.expiryDate ? dateOnly(quote.expiryDate) : null,
    currency: quote.currency,
    subtotalMinor: quote.subtotalMinor.toString(),
    totalMinor: quote.totalMinor.toString(),
    convertedInvoiceId: quote.convertedInvoiceId,
    sentAt: quote.sentAt?.toISOString() ?? null,
    lines: quote.lines.map((line) => ({
      id: line.id,
      lineNumber: line.lineNumber,
      itemId: line.itemId,
      descriptionSnapshot: line.descriptionSnapshot,
      quantity: line.quantity.toString(),
      unitPriceMinor: line.unitPriceMinor.toString(),
      discountMinor: line.discountMinor.toString(),
      lineTotalMinor: line.lineTotalMinor.toString(),
      taxCodeId: line.taxCodeId,
      warehouseId: line.warehouseId,
    })),
    createdAt: quote.createdAt.toISOString(),
    updatedAt: quote.updatedAt.toISOString(),
    version: quote.version,
  };
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isoDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}
