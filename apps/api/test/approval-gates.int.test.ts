import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ApprovalTargetType } from '@prisma/client';
import type { PublicUser } from '../src/auth/auth.service.js';
import { ApprovalTargetsService } from '../src/automation/approval-targets.service.js';
import { ApprovalsService } from '../src/automation/approvals.service.js';
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
import { CreditNotesService } from '../src/sales/credit-notes.service.js';
import { CustomersService } from '../src/sales/customers.service.js';
import { QuotesService } from '../src/sales/quotes.service.js';
import { SalesOrdersService } from '../src/sales/sales-orders.service.js';
import { createTestHarness, type TestHarness } from './support/app.js';

const metadata = {
  ipHash: 'approval-gates-test',
  userAgent: 'RetailBooks integration test',
};

const AWAITING_APPROVAL_ERROR = 'This document is awaiting approval and cannot be finalized.';

describe('approval gates on every target finalize action against a real database', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let periods: FiscalPeriodsService;
  let customers: CustomersService;
  let vendors: VendorsService;
  let quotes: QuotesService;
  let salesOrders: SalesOrdersService;
  let creditNotes: CreditNotesService;
  let purchaseOrders: PurchaseOrdersService;
  let bills: BillsService;
  let paymentsMade: PaymentsMadeService;
  let inventory: InventoryService;
  let catalog: CatalogService;
  let ledger: LedgerService;
  let approvals: ApprovalsService;
  let targets: ApprovalTargetsService;
  let owner: PublicUser;
  let context: OrganizationContext;
  let contactId: string;
  let vendorId: string;
  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
    periods = harness.app.get(FiscalPeriodsService);
    customers = harness.app.get(CustomersService);
    vendors = harness.app.get(VendorsService);
    quotes = harness.app.get(QuotesService);
    salesOrders = harness.app.get(SalesOrdersService);
    creditNotes = harness.app.get(CreditNotesService);
    purchaseOrders = harness.app.get(PurchaseOrdersService);
    bills = harness.app.get(BillsService);
    paymentsMade = harness.app.get(PaymentsMadeService);
    inventory = harness.app.get(InventoryService);
    catalog = harness.app.get(CatalogService);
    ledger = harness.app.get(LedgerService);
    approvals = harness.app.get(ApprovalsService);
    targets = harness.app.get(ApprovalTargetsService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    const user = await harness.prisma.user.create({
      data: {
        email: 'gates-owner@example.test',
        displayName: 'Gates Owner',
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
      { legalName: 'Gate Books Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
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

    const vendor = await vendors.create(context, owner, { displayName: 'Gate Supplies' }, metadata);
    vendorId = vendor.id;
  });

  /** A second ADMIN member so decisions do not trip the self-approval guard. */
  async function createMember(emailLocal: string) {
    const role = await harness.prisma.role.findFirstOrThrow({
      where: { organizationId: context.id, key: 'ADMIN' },
    });
    const actorUser = await harness.prisma.user.create({
      data: {
        email: `${emailLocal}@example.test`,
        displayName: emailLocal,
        emailVerifiedAt: new Date(),
        status: 'ACTIVE',
      },
    });
    await harness.prisma.organizationMember.create({
      data: { organizationId: context.id, userId: actorUser.id, roleId: role.id, status: 'ACTIVE' },
    });
    const memberContext = await access.requireMembership(actorUser.id, context.id);
    const publicUser: PublicUser = {
      id: actorUser.id,
      email: actorUser.email,
      displayName: actorUser.displayName,
      emailVerified: true,
      status: actorUser.status,
    };
    return { user: publicUser, context: memberContext };
  }

  async function activatePolicy(targetType: ApprovalTargetType, approverUserId: string) {
    const policy = await approvals.createPolicy(
      context,
      owner,
      {
        name: `${targetType} sign-off`,
        targetType,
        priority: 0,
        allowSelfApproval: false,
        steps: [{ approverUserId, label: 'Finance sign-off' }],
      },
      metadata,
    );
    await approvals.setPolicyStatus(context, owner, policy.id, 'ACTIVE', metadata);
    return policy;
  }

  describe('QUOTE', () => {
    it('blocks convertToInvoice while an approval request is pending', async () => {
      const approver = await createMember('gate-approver-quote');
      await activatePolicy('QUOTE', approver.user.id);

      const draft = await quotes.createDraft(
        context,
        owner,
        { contactId, lines: [{ description: 'Widget', quantity: '1', unitPriceMinor: '1000' }] },
        metadata,
      );
      await quotes.submitForApproval(context, owner, draft.id, metadata);
      await quotes.approve(context, owner, draft.id, metadata);
      await quotes.send(context, owner, draft.id, metadata);
      await quotes.accept(context, owner, draft.id, metadata);

      const request = await targets.submit(context, owner, 'QUOTE', draft.id, metadata);
      expect(request.status).toBe('PENDING');

      await expect(quotes.convertToInvoice(context, owner, draft.id, metadata)).rejects.toThrow(
        AWAITING_APPROVAL_ERROR,
      );
      expect(
        await harness.prisma.invoice.count({ where: { convertedFromQuote: { id: draft.id } } }),
      ).toBe(0);

      await approvals.decide(
        approver.context,
        approver.user,
        request.id,
        { decision: 'APPROVED' },
        metadata,
      );

      const converted = await quotes.convertToInvoice(context, owner, draft.id, metadata);
      expect(converted.status).toBe('CONVERTED');
      expect(
        await harness.prisma.invoice.count({ where: { convertedFromQuote: { id: draft.id } } }),
      ).toBe(1);
    });
  });

  describe('SALES_ORDER', () => {
    it('blocks convertToInvoice while an approval request is pending', async () => {
      const approver = await createMember('gate-approver-so');
      await activatePolicy('SALES_ORDER', approver.user.id);

      const draft = await salesOrders.createDraft(
        context,
        owner,
        { contactId, lines: [{ description: 'Widget', quantity: '1', unitPriceMinor: '1000' }] },
        metadata,
      );
      await salesOrders.approve(context, owner, draft.id, metadata);
      await salesOrders.confirm(context, owner, draft.id, metadata);

      const request = await targets.submit(context, owner, 'SALES_ORDER', draft.id, metadata);
      expect(request.status).toBe('PENDING');

      await expect(
        salesOrders.convertToInvoice(context, owner, draft.id, metadata),
      ).rejects.toThrow(AWAITING_APPROVAL_ERROR);
      expect(
        await harness.prisma.invoice.count({
          where: { convertedFromSalesOrder: { id: draft.id } },
        }),
      ).toBe(0);

      await approvals.decide(
        approver.context,
        approver.user,
        request.id,
        { decision: 'APPROVED' },
        metadata,
      );

      const converted = await salesOrders.convertToInvoice(context, owner, draft.id, metadata);
      expect(converted.convertedInvoiceId).toBeTruthy();
      expect(
        await harness.prisma.invoice.count({
          where: { convertedFromSalesOrder: { id: draft.id } },
        }),
      ).toBe(1);
    });
  });

  describe('CREDIT_NOTE', () => {
    it('blocks issuing while an approval request is pending, then issues after approval', async () => {
      const approver = await createMember('gate-approver-cn');
      await activatePolicy('CREDIT_NOTE', approver.user.id);

      const draft = await creditNotes.createDraft(
        context,
        owner,
        {
          contactId,
          lines: [{ description: 'Widget', quantity: '1', unitPriceMinor: '1000' }],
        },
        metadata,
      );

      const request = await targets.submit(context, owner, 'CREDIT_NOTE', draft.id, metadata);
      expect(request.status).toBe('PENDING');

      await expect(creditNotes.issueCreditNote(context, owner, draft.id, metadata)).rejects.toThrow(
        AWAITING_APPROVAL_ERROR,
      );
      expect(
        await harness.prisma.creditNote.findUniqueOrThrow({ where: { id: draft.id } }),
      ).toHaveProperty('status', 'DRAFT');

      await approvals.decide(
        approver.context,
        approver.user,
        request.id,
        { decision: 'APPROVED' },
        metadata,
      );

      const issued = await creditNotes.issueCreditNote(context, owner, draft.id, metadata);
      expect(issued.status).toBe('ISSUED');
      expect(issued.creditNoteNumber).toMatch(/^CRN-/);
    });
  });

  describe('PURCHASE_ORDER', () => {
    it('blocks issuing while an approval request is pending, then issues after approval', async () => {
      const approver = await createMember('gate-approver-po');
      await activatePolicy('PURCHASE_ORDER', approver.user.id);

      const draft = await purchaseOrders.createDraft(
        context,
        owner,
        {
          vendorId,
          lines: [{ description: 'Widget stock', quantity: '2', unitPriceMinor: '1000' }],
        },
        metadata,
      );
      await purchaseOrders.approve(context, owner, draft.id, metadata);

      const request = await targets.submit(context, owner, 'PURCHASE_ORDER', draft.id, metadata);
      expect(request.status).toBe('PENDING');

      await expect(purchaseOrders.issue(context, owner, draft.id, metadata)).rejects.toThrow(
        AWAITING_APPROVAL_ERROR,
      );
      expect(
        await harness.prisma.purchaseOrder.findUniqueOrThrow({ where: { id: draft.id } }),
      ).toHaveProperty('status', 'APPROVED');

      await approvals.decide(
        approver.context,
        approver.user,
        request.id,
        { decision: 'APPROVED' },
        metadata,
      );

      const issued = await purchaseOrders.issue(context, owner, draft.id, metadata);
      expect(issued.status).toBe('ISSUED');
      expect(issued.orderNumber).toMatch(/^PO-/);
    });
  });

  describe('BILL', () => {
    it('blocks issuing while an approval request is pending, then issues after approval', async () => {
      const approver = await createMember('gate-approver-bill');
      await activatePolicy('BILL', approver.user.id);

      const draft = await bills.createDraft(
        context,
        owner,
        {
          vendorId,
          lines: [{ description: 'Widget stock', quantity: '2', unitPriceMinor: '1000' }],
        },
        metadata,
      );

      const request = await targets.submit(context, owner, 'BILL', draft.id, metadata);
      expect(request.status).toBe('PENDING');

      await expect(bills.issueBill(context, owner, draft.id, metadata)).rejects.toThrow(
        AWAITING_APPROVAL_ERROR,
      );
      expect(
        await harness.prisma.bill.findUniqueOrThrow({ where: { id: draft.id } }),
      ).toHaveProperty('status', 'DRAFT');

      await approvals.decide(
        approver.context,
        approver.user,
        request.id,
        { decision: 'APPROVED' },
        metadata,
      );

      const issued = await bills.issueBill(context, owner, draft.id, metadata);
      expect(issued.status).toBe('ISSUED');
      expect(issued.billNumber).toMatch(/^BILL-/);
    });
  });

  describe('INVENTORY_ADJUSTMENT', () => {
    it('blocks posting while an approval request is pending, then posts after approval', async () => {
      const approver = await createMember('gate-approver-adj');
      await activatePolicy('INVENTORY_ADJUSTMENT', approver.user.id);

      const item = await catalog.createItem(
        context,
        owner,
        { name: 'Adjustment Widget', itemType: 'GOODS', inventoryTracked: true },
        metadata,
      );
      const warehouse = await inventory.createWarehouse(
        context,
        owner,
        { code: 'MAIN', name: 'Main warehouse' },
        metadata,
      );

      const draft = await inventory.createAdjustment(
        context,
        owner,
        {
          itemId: item.id,
          warehouseId: warehouse.id,
          adjustmentDate: '2026-02-01',
          quantityDelta: '5',
          valueDeltaMinor: '400',
          reason: 'Seed inventory layer',
        },
        metadata,
      );

      const request = await targets.submit(
        context,
        owner,
        'INVENTORY_ADJUSTMENT',
        draft.id,
        metadata,
      );
      expect(request.status).toBe('PENDING');

      await expect(inventory.postAdjustment(context, owner, draft.id, metadata)).rejects.toThrow(
        AWAITING_APPROVAL_ERROR,
      );
      expect(
        await harness.prisma.inventoryAdjustment.findUniqueOrThrow({ where: { id: draft.id } }),
      ).toHaveProperty('status', 'DRAFT');

      await approvals.decide(
        approver.context,
        approver.user,
        request.id,
        { decision: 'APPROVED' },
        metadata,
      );

      const posted = await inventory.postAdjustment(context, owner, draft.id, metadata);
      expect(posted.status).toBe('POSTED');
    });
  });

  describe('JOURNAL', () => {
    it('blocks posting while an approval request is pending, then posts after approval', async () => {
      const approver = await createMember('gate-approver-jrnl');
      await activatePolicy('JOURNAL', approver.user.id);

      const cash = await ledger.accountBySystemKey(context.id, 'bank_default');
      const sales = await ledger.accountBySystemKey(context.id, 'sales_revenue');

      const draft = await ledger.createJournalDraft(context, owner, {
        journalDate: '2026-02-01',
        currency: 'KES',
        description: 'Manual correction',
        lines: [
          { accountId: cash.id, debitMinor: '1200', creditMinor: '0' },
          { accountId: sales.id, debitMinor: '0', creditMinor: '1200' },
        ],
      });

      const request = await targets.submit(context, owner, 'JOURNAL', draft.id, metadata);
      expect(request.status).toBe('PENDING');

      await expect(ledger.postJournal(context, owner, draft.id, metadata)).rejects.toThrow(
        AWAITING_APPROVAL_ERROR,
      );
      expect(
        await harness.prisma.journal.findUniqueOrThrow({ where: { id: draft.id } }),
      ).toHaveProperty('status', 'DRAFT');

      await approvals.decide(
        approver.context,
        approver.user,
        request.id,
        { decision: 'APPROVED' },
        metadata,
      );

      const posted = await ledger.postJournal(context, owner, draft.id, metadata);
      expect(posted.status).toBe('POSTED');
    });
  });

  describe('PAYMENT_MADE', () => {
    it('has no finalize gate: submit still freezes a snapshot although nothing ever checks it', async () => {
      // Documented Phase 10 gap (PHASE10_TODO.md 10C / PHASE10_TEST_PLAN.md §2): payments made
      // post their AP/bank journal atomically at creation, so there is no separate finalize action
      // to gate. This test pins that behavior so the gap is at least explicit in the suite.
      const approver = await createMember('gate-approver-pmd');
      await activatePolicy('PAYMENT_MADE', approver.user.id);

      const payment = await paymentsMade.record(
        context,
        owner,
        { vendorId, paidDate: '2026-02-01', amountMinor: '1500' },
        metadata,
      );
      expect(payment.status).toBe('UNAPPLIED');

      const request = await targets.submit(context, owner, 'PAYMENT_MADE', payment.id, metadata);
      expect(request.status).toBe('PENDING');
      expect(request.targetType).toBe('PAYMENT_MADE');
      expect(request.targetId).toBe(payment.id);
    });
  });
});
