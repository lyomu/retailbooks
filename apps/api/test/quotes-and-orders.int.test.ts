import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PublicUser } from '../src/auth/auth.service.js';
import { FiscalPeriodsService } from '../src/organizations/fiscal-periods.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import type { OrganizationContext } from '../src/organizations/organization-context.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { CustomersService } from '../src/sales/customers.service.js';
import { QuotesService } from '../src/sales/quotes.service.js';
import { SalesOrdersService } from '../src/sales/sales-orders.service.js';
import { createTestHarness, type TestHarness } from './support/app.js';

const metadata = {
  ipHash: 'quotes-and-orders-test',
  userAgent: 'RetailBooks integration test',
};

describe('quote and sales order workflows against a real database', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let periods: FiscalPeriodsService;
  let customers: CustomersService;
  let quotes: QuotesService;
  let salesOrders: SalesOrdersService;
  let owner: PublicUser;
  let context: OrganizationContext;
  let contactId: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
    periods = harness.app.get(FiscalPeriodsService);
    customers = harness.app.get(CustomersService);
    quotes = harness.app.get(QuotesService);
    salesOrders = harness.app.get(SalesOrdersService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    const user = await harness.prisma.user.create({
      data: {
        email: 'quotes-owner@example.test',
        displayName: 'Quotes Owner',
        emailVerifiedAt: new Date(),
        status: 'ACTIVE',
      },
    });
    owner = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      emailVerified: true,
      status: user.status,
    };
    const created = await organizations.create(
      owner,
      { legalName: 'Quote Books Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    const draftContext = await access.requireMembership(owner.id, created.id);
    await organizations.finalize(draftContext, owner, metadata);
    context = await access.requireMembership(owner.id, created.id);
    await periods.generateFiscalYear(context, owner, { startsOn: '2026-01-01' }, metadata);

    const contact = await customers.create(
      context,
      owner,
      { displayName: 'Acme Retail', email: 'acme-retail@example.test' },
      metadata,
    );
    contactId = contact.id;
  });

  describe('Quote', () => {
    it('rejects approving a quote that has not been submitted', async () => {
      const draft = await quotes.createDraft(
        context,
        owner,
        { contactId, lines: [{ description: 'Widget', quantity: '1', unitPriceMinor: '1000' }] },
        metadata,
      );
      await expect(quotes.approve(context, owner, draft.id, metadata)).rejects.toThrow(
        'Only quotes pending approval can be approved.',
      );
    });

    it('walks the full happy path and converts to a draft invoice matching its lines exactly', async () => {
      const draft = await quotes.createDraft(
        context,
        owner,
        {
          contactId,
          lines: [
            { description: 'Widget A', quantity: '2', unitPriceMinor: '1000' },
            { description: 'Widget B', quantity: '1', unitPriceMinor: '500' },
          ],
        },
        metadata,
      );
      expect(draft.totalMinor).toBe('2500');

      const submitted = await quotes.submitForApproval(context, owner, draft.id, metadata);
      expect(submitted.status).toBe('PENDING_APPROVAL');
      expect(submitted.quoteNumber).toMatch(/^QUO-/);

      const approved = await quotes.approve(context, owner, draft.id, metadata);
      expect(approved.status).toBe('APPROVED');

      const sent = await quotes.send(context, owner, draft.id, metadata);
      expect(sent.status).toBe('SENT');

      const accepted = await quotes.accept(context, owner, draft.id, metadata);
      expect(accepted.status).toBe('ACCEPTED');

      const converted = await quotes.convertToInvoice(context, owner, draft.id, metadata);
      expect(converted.status).toBe('CONVERTED');
      expect(converted.convertedInvoiceId).toBeTruthy();

      const invoice = await harness.prisma.invoice.findUniqueOrThrow({
        where: { id: converted.convertedInvoiceId! },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });
      expect(invoice.status).toBe('DRAFT');
      expect(invoice.subtotalMinor).toBe(2500n);
      expect(invoice.lines).toHaveLength(2);
      expect(invoice.lines[0]!.descriptionSnapshot).toBe('Widget A');
      expect(invoice.lines[0]!.lineTotalMinor).toBe(2000n);
      expect(invoice.lines[1]!.descriptionSnapshot).toBe('Widget B');
      expect(invoice.lines[1]!.lineTotalMinor).toBe(500n);
    });

    it('rejects converting a quote that was declined instead of accepted', async () => {
      const draft = await quotes.createDraft(
        context,
        owner,
        { contactId, lines: [{ description: 'Widget', quantity: '1', unitPriceMinor: '1000' }] },
        metadata,
      );
      await quotes.submitForApproval(context, owner, draft.id, metadata);
      await quotes.approve(context, owner, draft.id, metadata);
      await quotes.send(context, owner, draft.id, metadata);
      const declined = await quotes.decline(context, owner, draft.id, metadata);
      expect(declined.status).toBe('DECLINED');

      await expect(quotes.convertToInvoice(context, owner, draft.id, metadata)).rejects.toThrow(
        'Only accepted quotes can be converted to an invoice.',
      );
    });

    it('marks a sent quote expired', async () => {
      const draft = await quotes.createDraft(
        context,
        owner,
        { contactId, lines: [{ description: 'Widget', quantity: '1', unitPriceMinor: '1000' }] },
        metadata,
      );
      await quotes.submitForApproval(context, owner, draft.id, metadata);
      await quotes.approve(context, owner, draft.id, metadata);
      await quotes.send(context, owner, draft.id, metadata);
      const expired = await quotes.expire(context, owner, draft.id, metadata);
      expect(expired.status).toBe('EXPIRED');
    });
  });

  describe('SalesOrder', () => {
    it('rejects confirming an order that has not been approved', async () => {
      const draft = await salesOrders.createDraft(
        context,
        owner,
        { contactId, lines: [{ description: 'Widget', quantity: '1', unitPriceMinor: '1000' }] },
        metadata,
      );
      await expect(salesOrders.confirm(context, owner, draft.id, metadata)).rejects.toThrow(
        'Only approved orders can be confirmed.',
      );
    });

    it('walks the full happy path and converts to a draft invoice without changing its own status', async () => {
      const draft = await salesOrders.createDraft(
        context,
        owner,
        {
          contactId,
          lines: [{ description: 'Widget', quantity: '3', unitPriceMinor: '1000' }],
        },
        metadata,
      );

      const approved = await salesOrders.approve(context, owner, draft.id, metadata);
      expect(approved.status).toBe('APPROVED');
      expect(approved.orderNumber).toMatch(/^SO-/);

      const confirmed = await salesOrders.confirm(context, owner, draft.id, metadata);
      expect(confirmed.status).toBe('CONFIRMED');

      const fulfilled = await salesOrders.markFulfilled(context, owner, draft.id, metadata);
      expect(fulfilled.status).toBe('FULFILLED');

      const converted = await salesOrders.convertToInvoice(context, owner, draft.id, metadata);
      // Unlike Quote, converting doesn't change status -- fulfillment and invoicing are independent.
      expect(converted.status).toBe('FULFILLED');
      expect(converted.convertedInvoiceId).toBeTruthy();

      const invoice = await harness.prisma.invoice.findUniqueOrThrow({
        where: { id: converted.convertedInvoiceId! },
        include: { lines: true },
      });
      expect(invoice.subtotalMinor).toBe(3000n);
      expect(invoice.lines).toHaveLength(1);
      expect(invoice.lines[0]!.lineTotalMinor).toBe(3000n);
    });

    it('rejects converting the same order to an invoice twice', async () => {
      const draft = await salesOrders.createDraft(
        context,
        owner,
        { contactId, lines: [{ description: 'Widget', quantity: '1', unitPriceMinor: '1000' }] },
        metadata,
      );
      await salesOrders.approve(context, owner, draft.id, metadata);
      await salesOrders.confirm(context, owner, draft.id, metadata);
      await salesOrders.convertToInvoice(context, owner, draft.id, metadata);

      await expect(
        salesOrders.convertToInvoice(context, owner, draft.id, metadata),
      ).rejects.toThrow('This order has already been converted to an invoice.');
    });

    it('rejects cancelling a fulfilled order', async () => {
      const draft = await salesOrders.createDraft(
        context,
        owner,
        { contactId, lines: [{ description: 'Widget', quantity: '1', unitPriceMinor: '1000' }] },
        metadata,
      );
      await salesOrders.approve(context, owner, draft.id, metadata);
      await salesOrders.confirm(context, owner, draft.id, metadata);
      await salesOrders.markFulfilled(context, owner, draft.id, metadata);

      await expect(salesOrders.cancel(context, owner, draft.id, metadata)).rejects.toThrow(
        'Fulfilled orders cannot be cancelled.',
      );
    });

    it('allows cancelling a draft order', async () => {
      const draft = await salesOrders.createDraft(
        context,
        owner,
        { contactId, lines: [{ description: 'Widget', quantity: '1', unitPriceMinor: '1000' }] },
        metadata,
      );
      const cancelled = await salesOrders.cancel(context, owner, draft.id, metadata);
      expect(cancelled.status).toBe('CANCELLED');
    });
  });
});
