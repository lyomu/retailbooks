import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PublicUser } from '../src/auth/auth.service.js';
import { CollectionsPrioritizerService } from '../src/insights/collections-prioritizer.service.js';
import { InventoryPurchasingAdviserService } from '../src/insights/inventory-purchasing-adviser.service.js';
import { InventoryService } from '../src/inventory/inventory.service.js';
import { FiscalPeriodsService } from '../src/organizations/fiscal-periods.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import type { OrganizationContext } from '../src/organizations/organization-context.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { CatalogService } from '../src/sales/catalog.service.js';
import { CustomersService } from '../src/sales/customers.service.js';
import { InvoicesService } from '../src/sales/invoices.service.js';
import { createTestHarness, type TestHarness } from './support/app.js';

const metadata = {
  ipHash: 'phase13-insights-fixtures-test',
  userAgent: 'RetailBooks insights fixture test',
};

function daysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

/**
 * Fixture-based correctness tests for two 13F-P2 advisers that read raw SQL directly: real
 * ranking/math output, not just "resolves without throwing". `InventoryPurchasingAdviserService`
 * is the closest analogue to the bigint-SUM bug already fixed elsewhere (SUM() CTEs over the
 * bigint `stock_movements.quantity` column) -- its cast to `::text` in the final SELECT is
 * verified here against real posted stock movements rather than trusted by inspection.
 * `CollectionsPrioritizerService` selects a bigint column directly (no aggregate), a lower-risk
 * shape, verified here for the same reason: no automated test previously asserted its actual
 * output against known values.
 */
describe('Phase 13F-P2 adviser correctness against real posted activity', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let periods: FiscalPeriodsService;
  let catalog: CatalogService;
  let inventory: InventoryService;
  let customers: CustomersService;
  let invoices: InvoicesService;
  let inventoryAdviser: InventoryPurchasingAdviserService;
  let collections: CollectionsPrioritizerService;
  let owner: PublicUser;
  let context: OrganizationContext;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
    periods = harness.app.get(FiscalPeriodsService);
    catalog = harness.app.get(CatalogService);
    inventory = harness.app.get(InventoryService);
    customers = harness.app.get(CustomersService);
    invoices = harness.app.get(InvoicesService);
    inventoryAdviser = harness.app.get(InventoryPurchasingAdviserService);
    collections = harness.app.get(CollectionsPrioritizerService);
  });

  afterAll(async () => harness.close());

  beforeEach(async () => {
    await harness.reset();
    const user = await harness.prisma.user.create({
      data: {
        email: 'insights-fixtures-owner@example.test',
        displayName: 'Insights Fixtures Owner',
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
      { legalName: 'Insights Fixtures Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    const draft = await access.requireMembership(owner.id, created.id);
    await organizations.finalize(draft, owner, metadata);
    context = await access.requireMembership(owner.id, created.id);
    // Both advisers window relative to the real clock, not a fixed fixture date.
    const fiscalYearStart = `${new Date().getUTCFullYear()}-01-01`;
    await periods.generateFiscalYear(context, owner, { startsOn: fiscalYearStart }, metadata);
  });

  it('computes days-of-stock-remaining and urgency from real on-hand and 30-day outflow', async () => {
    const item = await catalog.createItem(
      context,
      owner,
      {
        sku: 'REORDER-001',
        name: 'Reorder widget',
        itemType: 'GOODS',
        inventoryTracked: true,
        reorderThreshold: '5',
        reorderQuantity: '10',
      },
      metadata,
    );
    const warehouse = await inventory.createWarehouse(
      context,
      owner,
      { code: 'MAIN', name: 'Main Warehouse' },
      metadata,
    );

    // Bring 20 units on hand, dated safely inside the fiscal year but outside the 30-day outflow
    // window, so it only ever contributes to on-hand, never to outflow.
    const inbound = await inventory.createAdjustment(
      context,
      owner,
      {
        itemId: item.id,
        warehouseId: warehouse.id,
        adjustmentDate: daysAgo(45),
        quantityDelta: '20',
        valueDeltaMinor: '20000',
        reason: 'Opening stock fixture',
      },
      metadata,
    );
    await inventory.postAdjustment(context, owner, inbound.id, metadata);

    // Sell 15 units today: an OUT movement inside the 30-day outflow window, bringing on-hand to
    // exactly the reorder threshold (5) so the item is included in the advice list.
    const customer = await customers.create(
      context,
      owner,
      { displayName: 'Reorder Customer' },
      metadata,
    );
    const salesDraft = await invoices.createDraft(
      context,
      owner,
      {
        contactId: customer.id,
        lines: [{ itemId: item.id, warehouseId: warehouse.id, quantity: '15', unitPriceMinor: '5000' }],
      },
      metadata,
    );
    await invoices.issueInvoice(context, owner, salesDraft.id, metadata);

    const advice = await inventoryAdviser.advise(context.id);

    expect(advice).toHaveLength(1);
    expect(advice[0]).toMatchObject({
      itemId: item.id,
      quantityOnHand: '5.0000',
      reorderPoint: '5.0000',
      suggestedOrderQuantity: '10.0000',
      averageDailyOutflow: 0.5,
      daysOfStockRemaining: 10,
      urgent: true,
    });
  });

  it('does not flag an item with ample stock and no urgency', async () => {
    const item = await catalog.createItem(
      context,
      owner,
      {
        sku: 'AMPLE-001',
        name: 'Ample stock widget',
        itemType: 'GOODS',
        inventoryTracked: true,
        reorderThreshold: '5',
        reorderQuantity: '10',
      },
      metadata,
    );
    const warehouse = await inventory.createWarehouse(
      context,
      owner,
      { code: 'AMPLE', name: 'Ample Warehouse' },
      metadata,
    );
    const inbound = await inventory.createAdjustment(
      context,
      owner,
      {
        itemId: item.id,
        warehouseId: warehouse.id,
        adjustmentDate: daysAgo(10),
        quantityDelta: '100',
        valueDeltaMinor: '100000',
        reason: 'Ample stock fixture',
      },
      metadata,
    );
    await inventory.postAdjustment(context, owner, inbound.id, metadata);

    const advice = await inventoryAdviser.advise(context.id);

    expect(advice.find((row) => row.itemId === item.id)).toBeUndefined();
  });

  it('ranks overdue invoices by exposure score (balance x days overdue) and suggests the right action band', async () => {
    const bigButRecentCustomer = await customers.create(
      context,
      owner,
      { displayName: 'Follow-up Customer' },
      metadata,
    );
    const followUpDraft = await invoices.createDraft(
      context,
      owner,
      {
        contactId: bigButRecentCustomer.id,
        dueDate: daysAgo(40),
        lines: [{ description: 'Consulting', quantity: '1', unitPriceMinor: '250000' }],
      },
      metadata,
    );
    const followUpInvoice = await invoices.issueInvoice(context, owner, followUpDraft.id, metadata);

    const escalateCustomer = await customers.create(
      context,
      owner,
      { displayName: 'Escalate Customer' },
      metadata,
    );
    const escalateDraft = await invoices.createDraft(
      context,
      owner,
      {
        contactId: escalateCustomer.id,
        dueDate: daysAgo(70),
        lines: [{ description: 'Retainer', quantity: '1', unitPriceMinor: '100000' }],
      },
      metadata,
    );
    const escalateInvoice = await invoices.issueInvoice(context, owner, escalateDraft.id, metadata);

    const ranked = await collections.rank(context.id);

    expect(ranked).toHaveLength(2);
    // 250000 * 40 = 10,000,000 outranks 100000 * 70 = 7,000,000.
    expect(ranked[0]).toMatchObject({
      invoiceId: followUpInvoice.id,
      balanceMinor: '250000',
      daysOverdue: 40,
      exposureScore: 10_000_000,
      suggestedAction: 'Follow up directly; a standard reminder has likely already run.',
    });
    expect(ranked[1]).toMatchObject({
      invoiceId: escalateInvoice.id,
      balanceMinor: '100000',
      daysOverdue: 70,
      exposureScore: 7_000_000,
      suggestedAction: 'Escalate: consider a formal collections process.',
    });
  });

  it('excludes invoices that are not yet overdue, fully paid, or have no balance', async () => {
    const customer = await customers.create(
      context,
      owner,
      { displayName: 'Not Yet Overdue Customer' },
      metadata,
    );
    const notOverdueDraft = await invoices.createDraft(
      context,
      owner,
      {
        contactId: customer.id,
        dueDate: daysAgo(-10),
        lines: [{ description: 'Future due', quantity: '1', unitPriceMinor: '50000' }],
      },
      metadata,
    );
    await invoices.issueInvoice(context, owner, notOverdueDraft.id, metadata);

    const ranked = await collections.rank(context.id);

    expect(ranked).toEqual([]);
  });
});
