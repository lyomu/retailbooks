import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PublicUser } from '../src/auth/auth.service.js';
import { InventoryService } from '../src/inventory/inventory.service.js';
import { FiscalPeriodsService } from '../src/organizations/fiscal-periods.service.js';
import { LedgerService } from '../src/organizations/ledger.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import type { OrganizationContext } from '../src/organizations/organization-context.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { BillsService } from '../src/purchases/bills.service.js';
import { PaymentsMadeService } from '../src/purchases/payments-made.service.js';
import { PurchaseOrdersService } from '../src/purchases/purchase-orders.service.js';
import { VendorsService } from '../src/purchases/vendors.service.js';
import { CatalogService } from '../src/sales/catalog.service.js';
import { CustomersService } from '../src/sales/customers.service.js';
import { InvoicesService } from '../src/sales/invoices.service.js';
import { PaymentsService } from '../src/sales/payments.service.js';
import { createTestHarness, type TestHarness } from './support/app.js';

const metadata = {
  ipHash: 'inventory-test',
  userAgent: 'RetailBooks integration test',
};

describe('inventory management against a real database', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let periods: FiscalPeriodsService;
  let ledger: LedgerService;
  let inventory: InventoryService;
  let catalog: CatalogService;
  let vendors: VendorsService;
  let purchaseOrders: PurchaseOrdersService;
  let bills: BillsService;
  let paymentsMade: PaymentsMadeService;
  let customers: CustomersService;
  let invoices: InvoicesService;
  let payments: PaymentsService;
  let owner: PublicUser;
  let context: OrganizationContext;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
    periods = harness.app.get(FiscalPeriodsService);
    ledger = harness.app.get(LedgerService);
    inventory = harness.app.get(InventoryService);
    catalog = harness.app.get(CatalogService);
    vendors = harness.app.get(VendorsService);
    purchaseOrders = harness.app.get(PurchaseOrdersService);
    bills = harness.app.get(BillsService);
    paymentsMade = harness.app.get(PaymentsMadeService);
    customers = harness.app.get(CustomersService);
    invoices = harness.app.get(InvoicesService);
    payments = harness.app.get(PaymentsService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    const user = await harness.prisma.user.create({
      data: {
        email: 'inventory-owner@example.test',
        displayName: 'Inventory Owner',
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
      { legalName: 'Inventory Books Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    const draftContext = await access.requireMembership(owner.id, created.id);
    await organizations.finalize(draftContext, owner, metadata);
    context = await access.requireMembership(owner.id, created.id);
    await periods.generateFiscalYear(context, owner, { startsOn: '2026-01-01' }, metadata);
  });

  it('posts adjustments as traceable movements only after the approval flow reaches post', async () => {
    const item = await trackedItem('ADJ-001', 'Adjustment widget');
    const warehouse = await createWarehouse('MAIN', 'Main Warehouse');

    const draft = await inventory.createAdjustment(
      context,
      owner,
      {
        itemId: item.id,
        warehouseId: warehouse.id,
        adjustmentDate: '2026-02-01',
        quantityDelta: '5',
        valueDeltaMinor: '5000',
        reason: 'Opening count',
      },
      metadata,
    );
    expect(draft.status).toBe('DRAFT');
    expect(await harness.prisma.stockMovement.count({ where: { organizationId: context.id } })).toBe(0);

    const submitted = await inventory.submitAdjustment(context, owner, draft.id, metadata);
    expect(submitted.status).toBe('PENDING_APPROVAL');
    const approved = await inventory.approveAdjustment(context, owner, draft.id, metadata);
    expect(approved.status).toBe('APPROVED');
    const posted = await inventory.postAdjustment(context, owner, draft.id, metadata);
    expect(posted.status).toBe('POSTED');

    const movement = await harness.prisma.stockMovement.findFirstOrThrow({
      where: { organizationId: context.id, sourceType: 'ADJUSTMENT', sourceId: draft.id },
    });
    expect(movement.direction).toBe('IN');
    expect(movement.quantity.toString()).toBe('5');
    expect(movement.totalCostMinor).toBe(5000n);
    expect((await inventory.valuationReport(context.id)).totalValueMinor).toBe('5000');
  });

  it('records transfers as paired movements with no net organization stock or GL change', async () => {
    const item = await trackedItem('TRF-001', 'Transfer widget');
    const main = await createWarehouse('MAIN', 'Main Warehouse');
    const overflow = await createWarehouse('OVR', 'Overflow Warehouse');
    await postPositiveAdjustment(item.id, main.id, '5', '5000');
    const inventoryAccount = await ledger.accountBySystemKey(context.id, 'inventory_asset');
    const inventoryBalanceBefore = await postedAccountBalance(inventoryAccount.id);

    const transfer = await inventory.transferStock(
      context,
      owner,
      {
        itemId: item.id,
        fromWarehouseId: main.id,
        toWarehouseId: overflow.id,
        transferDate: '2026-02-02',
        quantity: '2',
      },
      metadata,
    );

    const transferMovements = await harness.prisma.stockMovement.findMany({
      where: { organizationId: context.id, sourceType: 'TRANSFER', sourceId: transfer.id },
      orderBy: { direction: 'asc' },
    });
    expect(transferMovements).toHaveLength(2);
    expect(transferMovements.map((movement) => movement.direction).sort()).toEqual(['IN', 'OUT']);
    expect(
      transferMovements.reduce(
        (sum, movement) =>
          sum + (movement.direction === 'IN' ? Number(movement.quantity) : -Number(movement.quantity)),
        0,
      ),
    ).toBe(0);
    expect((await inventory.valuationReport(context.id)).totalValueMinor).toBe('5000');
    expect(await postedAccountBalance(inventoryAccount.id)).toBe(inventoryBalanceBefore);
  });

  it('costs stock issues under FIFO and weighted-average valuation methods', async () => {
    const fifoItem = await trackedItem('FIFO-001', 'FIFO widget');
    const fifoWarehouse = await createWarehouse('FIFO', 'FIFO Warehouse');
    await postPositiveAdjustment(fifoItem.id, fifoWarehouse.id, '1', '1000', '2026-02-01');
    await postPositiveAdjustment(fifoItem.id, fifoWarehouse.id, '1', '2000', '2026-02-02');

    const fifoInvoice = await issueTrackedInvoice(fifoItem.id, fifoWarehouse.id, '1.5');
    const fifoIssueCost = await salesIssueCost(fifoInvoice.id);
    expect(fifoIssueCost).toBe(2000n);
    expect((await inventory.valuationReport(context.id)).totalValueMinor).toBe('1000');

    await harness.reset();
    await setupOrganization('inventory-wac-owner@example.test');
    await harness.prisma.organizationPreference.update({
      where: { organizationId: context.id },
      data: { inventoryValuationMethod: 'WEIGHTED_AVERAGE' },
    });
    const wacItem = await trackedItem('WAC-001', 'Weighted widget');
    const wacWarehouse = await createWarehouse('WAC', 'Weighted Warehouse');
    await postPositiveAdjustment(wacItem.id, wacWarehouse.id, '1', '1000', '2026-02-01');
    await postPositiveAdjustment(wacItem.id, wacWarehouse.id, '1', '2000', '2026-02-02');

    const wacInvoice = await issueTrackedInvoice(wacItem.id, wacWarehouse.id, '1');
    const movement = await harness.prisma.stockMovement.findFirstOrThrow({
      where: { organizationId: context.id, sourceType: 'SALES_ISSUE', sourceId: wacInvoice.id },
    });
    expect(movement.quantity.toString()).toBe('1');
    expect(movement.unitCostMinor).toBe(1500n);
    expect(movement.totalCostMinor).toBe(1500n);
    expect((await inventory.valuationReport(context.id)).totalValueMinor).toBe('1500');
  });

  it('passes the retail scenario from purchase through inventory valuation agreeing to GL', async () => {
    const item = await trackedItem('RTL-001', 'Retail widget');
    const warehouse = await createWarehouse('MAIN', 'Main Warehouse');
    const vendor = await vendors.create(context, owner, { displayName: 'Inventory Supplier' }, metadata);
    const customer = await customers.create(context, owner, { displayName: 'Retail Customer' }, metadata);

    const poDraft = await purchaseOrders.createDraft(
      context,
      owner,
      {
        vendorId: vendor.id,
        lines: [
          {
            itemId: item.id,
            quantity: '2',
            unitPriceMinor: '1000',
            warehouseId: warehouse.id,
          },
        ],
      },
      metadata,
    );
    await purchaseOrders.approve(context, owner, poDraft.id, metadata);
    const po = await purchaseOrders.issue(context, owner, poDraft.id, metadata);

    const billDraft = await bills.createDraft(
      context,
      owner,
      {
        vendorId: vendor.id,
        purchaseOrderId: po.id,
        lines: [
          {
            itemId: item.id,
            purchaseOrderLineId: po.lines[0]!.id,
            quantity: '2',
            unitPriceMinor: '1000',
            warehouseId: warehouse.id,
          },
        ],
      },
      metadata,
    );
    const bill = await bills.issueBill(context, owner, billDraft.id, metadata);
    const vendorPayment = await paymentsMade.record(
      context,
      owner,
      { vendorId: vendor.id, paidDate: '2026-02-03', amountMinor: '2000' },
      metadata,
    );
    await paymentsMade.allocate(
      context,
      owner,
      vendorPayment.id,
      { allocations: [{ billId: bill.id, amountMinor: '2000' }] },
      metadata,
    );

    const received = await purchaseOrders.recordReceipt(
      context,
      owner,
      po.id,
      { lines: [{ purchaseOrderLineId: po.lines[0]!.id, quantity: '2' }] },
      metadata,
    );
    expect(received.receiptStatus).toBe('RECEIVED');

    const invoiceDraft = await invoices.createDraft(
      context,
      owner,
      {
        contactId: customer.id,
        lines: [
          {
            itemId: item.id,
            quantity: '1',
            unitPriceMinor: '2500',
            warehouseId: warehouse.id,
          },
        ],
      },
      metadata,
    );
    const invoice = await invoices.issueInvoice(context, owner, invoiceDraft.id, metadata);
    const customerPayment = await payments.record(
      context,
      owner,
      { contactId: customer.id, receivedDate: '2026-02-04', amountMinor: '2500' },
      metadata,
    );
    await payments.allocate(
      context,
      owner,
      customerPayment.id,
      { allocations: [{ invoiceId: invoice.id, amountMinor: '2500' }] },
      metadata,
    );

    const purchaseMovements = await harness.prisma.stockMovement.count({
      where: { organizationId: context.id, sourceType: 'PURCHASE_RECEIPT', sourceId: po.id },
    });
    const salesMovements = await harness.prisma.stockMovement.count({
      where: { organizationId: context.id, sourceType: 'SALES_ISSUE', sourceId: invoice.id },
    });
    expect(purchaseMovements).toBe(1);
    expect(salesMovements).toBe(1);
    expect(await salesIssueCost(invoice.id)).toBe(1000n);

    const refreshedBill = await harness.prisma.bill.findUniqueOrThrow({ where: { id: bill.id } });
    const refreshedInvoice = await harness.prisma.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
    });
    expect(refreshedBill.status).toBe('PAID');
    expect(refreshedInvoice.status).toBe('PAID');

    const valuation = await inventory.valuationReport(context.id);
    const inventoryAccount = await ledger.accountBySystemKey(context.id, 'inventory_asset');
    expect(valuation.totalValueMinor).toBe('1000');
    expect(await postedAccountBalance(inventoryAccount.id)).toBe(BigInt(valuation.totalValueMinor));
  });

  async function setupOrganization(email: string) {
    const user = await harness.prisma.user.create({
      data: {
        email,
        displayName: 'Inventory Owner',
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
      { legalName: 'Inventory Books Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    const draftContext = await access.requireMembership(owner.id, created.id);
    await organizations.finalize(draftContext, owner, metadata);
    context = await access.requireMembership(owner.id, created.id);
    await periods.generateFiscalYear(context, owner, { startsOn: '2026-01-01' }, metadata);
  }

  async function trackedItem(sku: string, name: string) {
    return catalog.createItem(
      context,
      owner,
      { sku, name, itemType: 'GOODS', inventoryTracked: true },
      metadata,
    );
  }

  async function createWarehouse(code: string, name: string) {
    return inventory.createWarehouse(context, owner, { code, name }, metadata);
  }

  async function postPositiveAdjustment(
    itemId: string,
    warehouseId: string,
    quantityDelta: string,
    valueDeltaMinor: string,
    adjustmentDate = '2026-02-01',
  ) {
    const adjustment = await inventory.createAdjustment(
      context,
      owner,
      {
        itemId,
        warehouseId,
        adjustmentDate,
        quantityDelta,
        valueDeltaMinor,
        reason: 'Seed inventory layer',
      },
      metadata,
    );
    return inventory.postAdjustment(context, owner, adjustment.id, metadata);
  }

  async function issueTrackedInvoice(itemId: string, warehouseId: string, quantity: string) {
    const customer = await customers.create(
      context,
      owner,
      { displayName: `Customer ${itemId.slice(0, 8)}` },
      metadata,
    );
    const draft = await invoices.createDraft(
      context,
      owner,
      {
        contactId: customer.id,
        lines: [{ itemId, warehouseId, quantity, unitPriceMinor: '5000' }],
      },
      metadata,
    );
    return invoices.issueInvoice(context, owner, draft.id, metadata);
  }

  async function salesIssueCost(invoiceId: string) {
    const movements = await harness.prisma.stockMovement.findMany({
      where: { organizationId: context.id, sourceType: 'SALES_ISSUE', sourceId: invoiceId },
    });
    return movements.reduce((sum, movement) => sum + movement.totalCostMinor, 0n);
  }

  async function postedAccountBalance(accountId: string) {
    const lines = await harness.prisma.journalLine.findMany({
      where: { organizationId: context.id, accountId, journal: { status: 'POSTED' } },
    });
    return lines.reduce((sum, line) => sum + line.debitMinor - line.creditMinor, 0n);
  }
});
