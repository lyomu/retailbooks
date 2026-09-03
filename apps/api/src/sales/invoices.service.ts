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
import { PrismaService } from '../database/prisma.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { EMAIL_JOB_NAMES } from '../jobs/email-job.js';
import { EmailQueueService } from '../jobs/email-queue.service.js';
import { writeAuditEvent } from '../organizations/audit-event.js';
import { INVOICE_DOCUMENT_TYPE } from '../organizations/document-numbering.js';
import { DocumentNumberingService } from '../organizations/document-numbering.service.js';
import { LedgerService } from '../organizations/ledger.service.js';
import type { OrganizationContext } from '../organizations/organization-context.js';
import { TaxService } from '../organizations/tax.service.js';
import { PostingRulesService } from '../posting-rules/posting-rules.service.js';
import { DocumentRenderingService } from './document-rendering.service.js';
import { INVOICE_ISSUE_RULE } from './invoice-posting-rule.js';
import type { CreateInvoiceDto, InvoiceLineDto, UpdateInvoiceDto } from './invoices.dto.js';
import { renderInvoiceHtml } from './pdf-templates.js';

const QUANTITY_SCALE = 10_000n;

type InvoiceWithLines = Prisma.InvoiceGetPayload<{ include: typeof invoiceDetailInclude }>;

const invoiceDetailInclude = {
  lines: { orderBy: { lineNumber: 'asc' } },
  contact: {
    select: { id: true, displayName: true, currency: true, receivableAccountId: true, email: true },
  },
} satisfies Prisma.InvoiceInclude;

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly rules: PostingRulesService,
    private readonly tax: TaxService,
    private readonly numbering: DocumentNumberingService,
    private readonly documentRendering: DocumentRenderingService,
    private readonly emailQueue: EmailQueueService,
    private readonly inventory: InventoryService,
  ) {}

  async list(organizationId: string, status?: string) {
    const invoices = await this.prisma.invoice.findMany({
      where: { organizationId, ...(status ? { status: status as never } : {}) },
      orderBy: [{ createdAt: 'desc' }],
      include: invoiceDetailInclude,
      take: 200,
    });
    return invoices.map(summarizeInvoice);
  }

  async detail(organizationId: string, invoiceId: string) {
    const invoice = await this.findOrThrow(organizationId, invoiceId);
    return summarizeInvoice(invoice);
  }

  /**
   * Creates a draft invoice.
   *
   * `externalTx` lets a caller that must not leave a half-finished invoice behind -- Projects
   * billing, which claims the time and expenses this invoice bills in the same breath -- create the
   * draft inside its own transaction. See `LedgerService#postJournalFromLines`'s `externalTx` for
   * the same idiom. Line resolution (contact, item, tax lookups) happens before the transaction
   * opens either way: it is read-only, and holding a write transaction across it buys nothing.
   */
  async createDraft(
    context: OrganizationContext,
    user: PublicUser,
    input: CreateInvoiceDto,
    metadata: RequestMetadata,
    externalTx?: Prisma.TransactionClient,
  ) {
    const contact = await this.prisma.contact.findFirst({
      where: { id: input.contactId, organizationId: context.id, type: 'CUSTOMER' },
    });
    if (!contact) throw new NotFoundException('Customer not found.');
    if (contact.status !== 'ACTIVE') {
      throw new ConflictException('Cannot invoice a deactivated customer.');
    }
    const currency = input.currency ?? contact.currency;
    const resolvedLines = await this.resolveLines(context, currency, input.lines);
    const totals = lineTotals(resolvedLines);

    const run = async (tx: Prisma.TransactionClient) => {
      const invoice = await tx.invoice.create({
        data: {
          organizationId: context.id,
          contactId: contact.id,
          currency,
          dueDate: input.dueDate ? isoDate(input.dueDate) : null,
          subtotalMinor: totals.subtotalMinor,
          taxTotalMinor: totals.taxTotalMinor,
          totalMinor: totals.totalMinor,
          balanceMinor: 0n,
          createdByUserId: user.id,
          lines: {
            create: resolvedLines.map((line, index) => lineCreateData(line, index, context.id)),
          },
        },
        include: invoiceDetailInclude,
      });

      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'sales.invoice_created',
        entityType: 'invoice',
        entityId: invoice.id,
        action: AuditAction.CREATE,
        after: { contactId: contact.id, totalMinor: totals.totalMinor.toString() },
        ipHash: metadata.ipHash,
      });

      return invoice;
    };

    const created = externalTx ? await run(externalTx) : await this.prisma.$transaction(run);
    return summarizeInvoice(created);
  }

  async updateDraft(
    context: OrganizationContext,
    user: PublicUser,
    invoiceId: string,
    input: UpdateInvoiceDto,
    metadata: RequestMetadata,
  ) {
    const existing = await this.findOrThrow(context.id, invoiceId);
    if (existing.status !== 'DRAFT') {
      throw new ConflictException('Only draft invoices can be edited.');
    }

    let contact = existing.contact;
    if (input.contactId && input.contactId !== existing.contactId) {
      const nextContact = await this.prisma.contact.findFirst({
        where: { id: input.contactId, organizationId: context.id, type: 'CUSTOMER' },
      });
      if (!nextContact) throw new NotFoundException('Customer not found.');
      if (nextContact.status !== 'ACTIVE') {
        throw new ConflictException('Cannot invoice a deactivated customer.');
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
        await tx.invoiceLine.deleteMany({ where: { invoiceId } });
      }
      const invoice = await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          contactId: contact.id,
          currency,
          dueDate: input.dueDate !== undefined ? isoDate(input.dueDate) : existing.dueDate,
          subtotalMinor: totals.subtotalMinor,
          taxTotalMinor: totals.taxTotalMinor,
          totalMinor: totals.totalMinor,
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
        include: invoiceDetailInclude,
      });

      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'sales.invoice_updated',
        entityType: 'invoice',
        entityId: invoiceId,
        action: AuditAction.UPDATE,
        before: { totalMinor: existing.totalMinor.toString() },
        after: { totalMinor: totals.totalMinor.toString() },
        ipHash: metadata.ipHash,
      });

      return invoice;
    });

    return summarizeInvoice(updated);
  }

  /**
   * Issues a draft invoice: freezes each line's tax snapshot, consolidates the lines by account
   * (one AR debit, one revenue credit per distinct revenue account, one tax credit per distinct tax
   * code), and posts the result through `LedgerService.postJournalFromLines`. The whole operation --
   * tax freezing, posting, invoice-number allocation, and the invoice's own DRAFT->ISSUED flip --
   * runs in one transaction, guarded by the same idempotency-lock-then-check pattern
   * `LedgerService.postJournal` uses, but scoped to the invoice itself (operation `'INVOICE_ISSUE'`,
   * resourceType `'INVOICE'`) so a replay returns the same issued invoice rather than re-running any
   * of it. `postJournalFromLines` is called with `idempotencyKey: undefined` and this transaction as
   * its `externalTx`: the invoice-level lock above already guarantees single execution, so a second,
   * separate idempotency record at the journal level would be redundant.
   */
  async issueInvoice(
    context: OrganizationContext,
    user: PublicUser,
    invoiceId: string,
    metadata: RequestMetadata,
    idempotencyKey?: string,
  ) {
    const issued = await this.prisma.$transaction(async (tx) => {
      await this.lockInvoiceIdempotency(tx, context.id, idempotencyKey);
      const existingResult = await this.findInvoiceIdempotentResult(context.id, idempotencyKey, tx);
      if (existingResult) {
        return tx.invoice.findFirstOrThrow({
          where: { id: existingResult.resourceId, organizationId: context.id },
          include: invoiceDetailInclude,
        });
      }

      await this.lockInvoiceRow(tx, context.id, invoiceId);
      const invoice = await tx.invoice.findFirst({
        where: { id: invoiceId, organizationId: context.id },
        include: invoiceDetailInclude,
      });
      if (!invoice) throw new NotFoundException('Invoice not found.');
      if (invoice.status !== 'DRAFT') {
        throw new ConflictException('Only draft invoices can be issued.');
      }
      if (invoice.lines.length === 0) {
        throw new BadRequestException(
          'An invoice needs at least one line before it can be issued.',
        );
      }

      const issueDate = dateOnly(new Date());

      const arAccount = invoice.contact.receivableAccountId
        ? await tx.ledgerAccount.findUniqueOrThrow({
            where: { id: invoice.contact.receivableAccountId },
          })
        : await this.ledger.accountBySystemKey(context.id, 'accounts_receivable', tx);

      // Keyed by revenue account *and* project so two projects sharing an account stay separable
      // on the ledger; the key is only a grouping device, the entry carries the real ids.
      const revenueByAccount = new Map<
        string,
        { accountId: string; projectId: string | null; amountMinor: bigint }
      >();
      const taxByCode = new Map<string, { accountId: string; amountMinor: bigint }>();
      let subtotalMinor = 0n;
      let taxTotalMinor = 0n;

      for (const line of invoice.lines) {
        subtotalMinor += line.lineTotalMinor;
        const revenueAccountId =
          line.revenueAccountId ??
          (await this.ledger.accountBySystemKey(context.id, 'sales_revenue', tx)).id;
        const revenueKey = `${revenueAccountId}:${line.projectId ?? ''}`;
        const existingRevenue = revenueByAccount.get(revenueKey);
        revenueByAccount.set(revenueKey, {
          accountId: revenueAccountId,
          projectId: line.projectId,
          amountMinor: (existingRevenue?.amountMinor ?? 0n) + line.lineTotalMinor,
        });

        if (line.taxCodeId) {
          const resolved = await this.tax.resolveForPosting(
            tx,
            context.id,
            line.taxCodeId,
            line.lineTotalMinor,
            issueDate,
          );
          await tx.invoiceLine.update({
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
        throw new BadRequestException('An invoice total must be greater than zero.');
      }

      const postedJournal = await this.rules.post(
        context,
        user,
        INVOICE_ISSUE_RULE,
        {
          sourceId: invoice.id,
          journalDate: new Date(`${issueDate}T00:00:00.000Z`),
          currency: invoice.currency,
          contactName: invoice.contact.displayName,
          arAccountId: arAccount.id,
          revenueByAccount: [...revenueByAccount.values()],
          taxByCode: [...taxByCode.values()].map((entry) => ({
            accountId: entry.accountId,
            amountMinor: entry.amountMinor,
          })),
          totalMinor,
        },
        metadata,
        undefined,
        tx,
      );

      const allocation = await this.numbering.allocateDocumentNumberWithClient(
        tx,
        context.id,
        INVOICE_DOCUMENT_TYPE,
        new Date(`${issueDate}T00:00:00.000Z`),
      );

      const updated = await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          status: 'ISSUED',
          invoiceNumber: allocation.value,
          issueDate: isoDate(issueDate),
          subtotalMinor,
          taxTotalMinor,
          totalMinor,
          balanceMinor: totalMinor,
          journalId: postedJournal.id,
        },
        include: invoiceDetailInclude,
      });

      await this.inventory.postInvoiceCogs(context, user, invoiceId, metadata, tx);
      await this.recordInvoiceIdempotency(tx, context.id, idempotencyKey, invoiceId);
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'sales.invoice_issued',
        entityType: 'invoice',
        entityId: invoiceId,
        action: AuditAction.UPDATE,
        before: { status: 'DRAFT' },
        after: {
          status: 'ISSUED',
          invoiceNumber: allocation.value,
          totalMinor: totalMinor.toString(),
        },
        ipHash: metadata.ipHash,
      });

      return updated;
    });

    return summarizeInvoice(issued);
  }

  /**
   * Voids an issued (or partially paid) invoice with no payments applied yet, reversing its posting
   * journal exactly the way a manual journal reversal does. An invoice with any `paidMinor` must be
   * corrected through a Credit Note instead (Milestone 2F) -- cash has already moved.
   */
  async voidInvoice(
    context: OrganizationContext,
    user: PublicUser,
    invoiceId: string,
    metadata: RequestMetadata,
  ) {
    const existing = await this.findOrThrow(context.id, invoiceId);
    if (existing.status !== 'ISSUED' && existing.status !== 'PARTIALLY_PAID') {
      throw new ConflictException('Only issued invoices can be voided.');
    }
    if (existing.paidMinor > 0n) {
      throw new ConflictException(
        'An invoice with payments applied cannot be voided; issue a credit note instead.',
      );
    }
    if (!existing.journalId) {
      throw new ConflictException('This invoice has no posted journal to reverse.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.ledger.reverseJournal(
        context,
        user,
        existing.journalId!,
        { description: `Void of invoice ${existing.invoiceNumber ?? existing.id}` },
        metadata,
        undefined,
        tx,
      );

      const invoice = await tx.invoice.update({
        where: { id: invoiceId },
        data: { status: 'VOID', voidedAt: new Date() },
        include: invoiceDetailInclude,
      });

      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'sales.invoice_voided',
        entityType: 'invoice',
        entityId: invoiceId,
        action: AuditAction.UPDATE,
        before: { status: existing.status },
        after: { status: 'VOID' },
        ipHash: metadata.ipHash,
      });

      return invoice;
    });

    return summarizeInvoice(updated);
  }

  /** Renders the invoice to PDF (cached after the first call -- a re-send never re-renders) and
   * enqueues an email job with the PDF as a pre-signed-URL attachment. `sentAt` updates on every
   * successful send, not just the first, so it reflects last-sent rather than first-sent. */
  async sendInvoice(
    context: OrganizationContext,
    user: PublicUser,
    invoiceId: string,
    metadata: RequestMetadata,
  ) {
    const existing = await this.findOrThrow(context.id, invoiceId);
    if (existing.status === 'DRAFT' || existing.status === 'VOID') {
      throw new ConflictException('Only issued invoices can be sent.');
    }
    if (!existing.contact.email) {
      throw new BadRequestException('This customer has no email address on file.');
    }

    const html = renderInvoiceHtml(context.legalName, {
      invoiceNumber: existing.invoiceNumber,
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
      'INVOICE',
      invoiceId,
      html,
    );
    const signedUrl = await this.documentRendering.getSignedUrl(storageKey);

    await this.emailQueue.enqueue(EMAIL_JOB_NAMES.invoiceSend, {
      to: existing.contact.email,
      subject: `Invoice ${existing.invoiceNumber ?? ''} from ${context.legalName}`,
      text: `Please find attached invoice ${existing.invoiceNumber ?? ''} from ${context.legalName}.`,
      html: `<p>Please find attached invoice ${existing.invoiceNumber ?? ''} from ${context.legalName}.</p>`,
      attachments: [{ filename: `${existing.invoiceNumber ?? invoiceId}.pdf`, path: signedUrl }],
    });

    const updated = await this.prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.update({
        where: { id: invoiceId },
        data: { sentAt: new Date() },
        include: invoiceDetailInclude,
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'sales.invoice_sent',
        entityType: 'invoice',
        entityId: invoiceId,
        action: AuditAction.UPDATE,
        after: { sentAt: invoice.sentAt!.toISOString() },
        ipHash: metadata.ipHash,
      });
      return invoice;
    });

    return summarizeInvoice(updated);
  }

  private async findOrThrow(organizationId: string, invoiceId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId },
      include: invoiceDetailInclude,
    });
    if (!invoice) throw new NotFoundException('Invoice not found.');
    return invoice;
  }

  private async resolveLines(
    context: OrganizationContext,
    currency: string,
    lines: readonly InvoiceLineDto[],
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
    const warehouseIds = Array.from(
      new Set(lines.map((line) => line.warehouseId).filter((id): id is string => Boolean(id))),
    );
    const warehouses =
      warehouseIds.length === 0
        ? []
        : await this.prisma.warehouse.findMany({
            where: { id: { in: warehouseIds }, organizationId },
          });
    const warehousesById = new Map(warehouses.map((warehouse) => [warehouse.id, warehouse]));

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
      if (item?.inventoryTracked && !line.warehouseId) {
        throw new BadRequestException(`${label}: tracked inventory needs a warehouse.`);
      }
      const warehouse = line.warehouseId ? warehousesById.get(line.warehouseId) : undefined;
      if (line.warehouseId && !warehouse) {
        throw new BadRequestException(`${label}: warehouse not found.`);
      }
      if (warehouse && warehouse.status !== 'ACTIVE') {
        throw new BadRequestException(`${label}: warehouse is inactive.`);
      }

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
        warehouseId: line.warehouseId ?? null,
        projectTag: line.projectTag ?? null,
        projectId: line.projectId ?? null,
      };
    });
  }

  private async lockInvoiceIdempotency(
    tx: Prisma.TransactionClient,
    organizationId: string,
    key?: string,
  ): Promise<void> {
    if (!key) return;
    const lockKey = `${organizationId}:INVOICE_ISSUE:${key}`;
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text AS locked
    `;
  }

  private async findInvoiceIdempotentResult(
    organizationId: string,
    key: string | undefined,
    tx: Prisma.TransactionClient,
  ): Promise<{ resourceId: string } | null> {
    if (!key) return null;
    return tx.ledgerIdempotencyKey.findUnique({
      where: {
        organizationId_operation_key: { organizationId, operation: 'INVOICE_ISSUE_INVOICE', key },
      },
      select: { resourceId: true },
    });
  }

  private recordInvoiceIdempotency(
    tx: Prisma.TransactionClient,
    organizationId: string,
    key: string | undefined,
    invoiceId: string,
  ) {
    if (!key) return undefined;
    return tx.ledgerIdempotencyKey.create({
      data: {
        organizationId,
        operation: 'INVOICE_ISSUE_INVOICE',
        key,
        resourceType: 'INVOICE',
        resourceId: invoiceId,
      },
    });
  }

  private async lockInvoiceRow(
    tx: Prisma.TransactionClient,
    organizationId: string,
    invoiceId: string,
  ): Promise<void> {
    await tx.$queryRaw`
      SELECT id
      FROM invoices
      WHERE id = ${invoiceId}::uuid AND organization_id = ${organizationId}::uuid
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
    warehouseId: string | null;
    projectTag: string | null;
    projectId: string | null;
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
    warehouseId: line.warehouseId,
    projectTag: line.projectTag,
    projectId: line.projectId,
  };
}

function summarizeInvoice(invoice: InvoiceWithLines) {
  return {
    id: invoice.id,
    contactId: invoice.contactId,
    contactName: invoice.contact.displayName,
    invoiceNumber: invoice.invoiceNumber,
    status: invoice.status,
    issueDate: invoice.issueDate ? dateOnly(invoice.issueDate) : null,
    dueDate: invoice.dueDate ? dateOnly(invoice.dueDate) : null,
    currency: invoice.currency,
    exchangeRate: invoice.exchangeRate?.toString() ?? null,
    subtotalMinor: invoice.subtotalMinor.toString(),
    taxTotalMinor: invoice.taxTotalMinor.toString(),
    totalMinor: invoice.totalMinor.toString(),
    paidMinor: invoice.paidMinor.toString(),
    balanceMinor: invoice.balanceMinor.toString(),
    journalId: invoice.journalId,
    voidedAt: invoice.voidedAt?.toISOString() ?? null,
    sentAt: invoice.sentAt?.toISOString() ?? null,
    lines: invoice.lines.map((line) => ({
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
      warehouseId: line.warehouseId,
      projectTag: line.projectTag,
      projectId: line.projectId,
    })),
    createdAt: invoice.createdAt.toISOString(),
    updatedAt: invoice.updatedAt.toISOString(),
  };
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isoDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}
