import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PublicUser } from '../src/auth/auth.service.js';
import { FiscalPeriodsService } from '../src/organizations/fiscal-periods.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import type { OrganizationContext } from '../src/organizations/organization-context.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { PurchaseOrdersService } from '../src/purchases/purchase-orders.service.js';
import { VendorsService } from '../src/purchases/vendors.service.js';
import { CatalogService } from '../src/sales/catalog.service.js';
import { createTestHarness, type TestHarness } from './support/app.js';

const metadata = {
  ipHash: 'purchase-orders-test',
  userAgent: 'RetailBooks integration test',
};

describe('purchase order workflows against a real database', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let periods: FiscalPeriodsService;
  let vendors: VendorsService;
  let catalog: CatalogService;
  let purchaseOrders: PurchaseOrdersService;
  let owner: PublicUser;
  let context: OrganizationContext;
  let vendorId: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
    periods = harness.app.get(FiscalPeriodsService);
    vendors = harness.app.get(VendorsService);
    catalog = harness.app.get(CatalogService);
    purchaseOrders = harness.app.get(PurchaseOrdersService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    const user = await harness.prisma.user.create({
      data: {
        email: 'purchase-orders-owner@example.test',
        displayName: 'Purchase Orders Owner',
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
      { legalName: 'Purchase Order Books Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    const draftContext = await access.requireMembership(owner.id, created.id);
    await organizations.finalize(draftContext, owner, metadata);
    context = await access.requireMembership(owner.id, created.id);
    await periods.generateFiscalYear(context, owner, { startsOn: '2026-01-01' }, metadata);

    const vendor = await vendors.create(context, owner, { displayName: 'Acme Supplies' }, metadata);
    vendorId = vendor.id;
  });

  function draftInput(overrides: { unitPriceMinor?: string } = {}) {
    return {
      vendorId,
      lines: [
        {
          description: 'Widget stock',
          quantity: '2',
          unitPriceMinor: overrides.unitPriceMinor ?? '1000',
        },
      ],
    };
  }

  describe('state transitions', () => {
    it('walks DRAFT -> APPROVED -> ISSUED -> CLOSED', async () => {
      const draft = await purchaseOrders.createDraft(context, owner, draftInput(), metadata);
      expect(draft.status).toBe('DRAFT');
      expect(draft.orderNumber).toBeNull();

      const approved = await purchaseOrders.approve(context, owner, draft.id, metadata);
      expect(approved.status).toBe('APPROVED');
      expect(approved.orderNumber).toBeNull();

      const issued = await purchaseOrders.issue(context, owner, draft.id, metadata);
      expect(issued.status).toBe('ISSUED');
      expect(issued.orderNumber).toMatch(/^PO-/);

      const closed = await purchaseOrders.close(context, owner, draft.id, metadata);
      expect(closed.status).toBe('CLOSED');
    });

    it('allows ISSUED -> CANCELLED as an alternative to CLOSED', async () => {
      const draft = await purchaseOrders.createDraft(context, owner, draftInput(), metadata);
      await purchaseOrders.approve(context, owner, draft.id, metadata);
      const issued = await purchaseOrders.issue(context, owner, draft.id, metadata);
      expect(issued.status).toBe('ISSUED');

      const cancelled = await purchaseOrders.cancel(context, owner, draft.id, metadata);
      expect(cancelled.status).toBe('CANCELLED');
    });

    it('allows cancelling straight from DRAFT', async () => {
      const draft = await purchaseOrders.createDraft(context, owner, draftInput(), metadata);
      const cancelled = await purchaseOrders.cancel(context, owner, draft.id, metadata);
      expect(cancelled.status).toBe('CANCELLED');
    });

    it('allows cancelling from APPROVED', async () => {
      const draft = await purchaseOrders.createDraft(context, owner, draftInput(), metadata);
      await purchaseOrders.approve(context, owner, draft.id, metadata);
      const cancelled = await purchaseOrders.cancel(context, owner, draft.id, metadata);
      expect(cancelled.status).toBe('CANCELLED');
    });

    it('rejects approving an order that is not a draft', async () => {
      const draft = await purchaseOrders.createDraft(context, owner, draftInput(), metadata);
      await purchaseOrders.approve(context, owner, draft.id, metadata);

      await expect(purchaseOrders.approve(context, owner, draft.id, metadata)).rejects.toThrow(
        'Only draft orders can be approved.',
      );
    });

    it('rejects issuing an order that has not been approved', async () => {
      const draft = await purchaseOrders.createDraft(context, owner, draftInput(), metadata);

      await expect(purchaseOrders.issue(context, owner, draft.id, metadata)).rejects.toThrow(
        'Only approved orders can be issued.',
      );
    });

    it('rejects issuing an order that has already been issued', async () => {
      const draft = await purchaseOrders.createDraft(context, owner, draftInput(), metadata);
      await purchaseOrders.approve(context, owner, draft.id, metadata);
      await purchaseOrders.issue(context, owner, draft.id, metadata);

      await expect(purchaseOrders.issue(context, owner, draft.id, metadata)).rejects.toThrow(
        'Only approved orders can be issued.',
      );
    });

    it('rejects closing an order that has not been issued', async () => {
      const draft = await purchaseOrders.createDraft(context, owner, draftInput(), metadata);
      await purchaseOrders.approve(context, owner, draft.id, metadata);

      await expect(purchaseOrders.close(context, owner, draft.id, metadata)).rejects.toThrow(
        'Only issued orders can be closed.',
      );
    });

    it('rejects cancelling a closed order', async () => {
      const draft = await purchaseOrders.createDraft(context, owner, draftInput(), metadata);
      await purchaseOrders.approve(context, owner, draft.id, metadata);
      await purchaseOrders.issue(context, owner, draft.id, metadata);
      await purchaseOrders.close(context, owner, draft.id, metadata);

      await expect(purchaseOrders.cancel(context, owner, draft.id, metadata)).rejects.toThrow(
        'Closed orders cannot be cancelled.',
      );
    });

    it('rejects cancelling an already-cancelled order', async () => {
      const draft = await purchaseOrders.createDraft(context, owner, draftInput(), metadata);
      await purchaseOrders.cancel(context, owner, draft.id, metadata);

      await expect(purchaseOrders.cancel(context, owner, draft.id, metadata)).rejects.toThrow(
        'Closed orders cannot be cancelled.',
      );
    });
  });

  describe('document numbering', () => {
    it('allocates the order number at issue(), not at approve()', async () => {
      const draft = await purchaseOrders.createDraft(context, owner, draftInput(), metadata);
      expect(draft.orderNumber).toBeNull();

      const approved = await purchaseOrders.approve(context, owner, draft.id, metadata);
      expect(approved.orderNumber).toBeNull();

      const stillApproved = await purchaseOrders.detail(context.id, draft.id);
      expect(stillApproved.orderNumber).toBeNull();

      const issued = await purchaseOrders.issue(context, owner, draft.id, metadata);
      expect(issued.orderNumber).toMatch(/^PO-/);
    });

    it('allocates distinct, increasing order numbers across separate orders', async () => {
      const first = await purchaseOrders.createDraft(context, owner, draftInput(), metadata);
      await purchaseOrders.approve(context, owner, first.id, metadata);
      const firstIssued = await purchaseOrders.issue(context, owner, first.id, metadata);

      const second = await purchaseOrders.createDraft(context, owner, draftInput(), metadata);
      await purchaseOrders.approve(context, owner, second.id, metadata);
      const secondIssued = await purchaseOrders.issue(context, owner, second.id, metadata);

      expect(firstIssued.orderNumber).not.toBe(secondIssued.orderNumber);
    });
  });

  describe('receipt status', () => {
    it('records a receipt status change on an issued order', async () => {
      const draft = await purchaseOrders.createDraft(context, owner, draftInput(), metadata);
      await purchaseOrders.approve(context, owner, draft.id, metadata);
      const issued = await purchaseOrders.issue(context, owner, draft.id, metadata);
      expect(issued.receiptStatus).toBe('NOT_RECEIVED');

      const partially = await purchaseOrders.recordReceipt(
        context,
        owner,
        draft.id,
        'PARTIALLY_RECEIVED',
        metadata,
      );
      expect(partially.receiptStatus).toBe('PARTIALLY_RECEIVED');
      // Receipt status is independent of the order's own workflow status.
      expect(partially.status).toBe('ISSUED');

      const received = await purchaseOrders.recordReceipt(
        context,
        owner,
        draft.id,
        'RECEIVED',
        metadata,
      );
      expect(received.receiptStatus).toBe('RECEIVED');
      expect(received.status).toBe('ISSUED');
    });

    it('rejects recording a receipt on an order that has not been issued', async () => {
      const draft = await purchaseOrders.createDraft(context, owner, draftInput(), metadata);

      await expect(
        purchaseOrders.recordReceipt(context, owner, draft.id, 'RECEIVED', metadata),
      ).rejects.toThrow('Only issued orders can have receipts recorded.');
    });
  });

  describe('vendor status guard', () => {
    it('rejects creating an order for a deactivated vendor', async () => {
      await vendors.setStatus(context, owner, vendorId, 'INACTIVE', metadata);

      await expect(
        purchaseOrders.createDraft(context, owner, draftInput(), metadata),
      ).rejects.toThrow('Cannot create an order for a deactivated vendor.');
    });

    it('rejects switching a draft order to a deactivated vendor', async () => {
      const draft = await purchaseOrders.createDraft(context, owner, draftInput(), metadata);
      const otherVendor = await vendors.create(
        context,
        owner,
        { displayName: 'Other Vendor' },
        metadata,
      );
      await vendors.setStatus(context, owner, otherVendor.id, 'INACTIVE', metadata);

      await expect(
        purchaseOrders.updateDraft(
          context,
          owner,
          draft.id,
          { vendorId: otherVendor.id },
          metadata,
        ),
      ).rejects.toThrow('Cannot create an order for a deactivated vendor.');
    });
  });

  describe('item-line validation', () => {
    it('rejects a line that omits unitPriceMinor', async () => {
      await expect(
        purchaseOrders.createDraft(
          context,
          owner,
          {
            vendorId,
            lines: [{ description: 'Widget stock', quantity: '1' }],
          },
          metadata,
        ),
      ).rejects.toThrow(
        'Line 1: a unit price is required (purchase prices have no per-item default).',
      );
    });

    it('rejects a line referencing an inactive item', async () => {
      const item = await catalog.createItem(
        context,
        owner,
        { name: 'Widget', itemType: 'GOODS' },
        metadata,
      );
      await catalog.setItemStatus(context, owner, item.id, 'INACTIVE', metadata);

      await expect(
        purchaseOrders.createDraft(
          context,
          owner,
          { vendorId, lines: [{ itemId: item.id, quantity: '1', unitPriceMinor: '1000' }] },
          metadata,
        ),
      ).rejects.toThrow('Line 1: item is not active.');
    });

    it('rejects a free-text description on an item that does not allow one', async () => {
      const item = await catalog.createItem(
        context,
        owner,
        { name: 'Widget', itemType: 'GOODS', freeDescriptionAllowed: false },
        metadata,
      );

      await expect(
        purchaseOrders.createDraft(
          context,
          owner,
          {
            vendorId,
            lines: [
              {
                itemId: item.id,
                description: 'Custom description',
                quantity: '1',
                unitPriceMinor: '1000',
              },
            ],
          },
          metadata,
        ),
      ).rejects.toThrow('Line 1: this item does not allow a free-text description.');
    });

    it('rejects a line with neither an item nor a description', async () => {
      await expect(
        purchaseOrders.createDraft(
          context,
          owner,
          { vendorId, lines: [{ quantity: '1', unitPriceMinor: '1000' }] },
          metadata,
        ),
      ).rejects.toThrow('Line 1: needs a description or an item.');
    });

    it('accepts a line built from an active item with an explicit unit price', async () => {
      const item = await catalog.createItem(
        context,
        owner,
        { name: 'Widget', itemType: 'GOODS' },
        metadata,
      );

      const draft = await purchaseOrders.createDraft(
        context,
        owner,
        { vendorId, lines: [{ itemId: item.id, quantity: '3', unitPriceMinor: '1500' }] },
        metadata,
      );
      expect(draft.totalMinor).toBe('4500');
      expect(draft.lines[0]!.itemId).toBe(item.id);
      expect(draft.lines[0]!.descriptionSnapshot).toBe('Widget');
    });
  });
});
