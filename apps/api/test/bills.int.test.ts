import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PublicUser } from '../src/auth/auth.service.js';
import { FiscalPeriodsService } from '../src/organizations/fiscal-periods.service.js';
import { LedgerService } from '../src/organizations/ledger.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import type { OrganizationContext } from '../src/organizations/organization-context.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { TaxService } from '../src/organizations/tax.service.js';
import { BillsService } from '../src/purchases/bills.service.js';
import { PurchaseOrdersService } from '../src/purchases/purchase-orders.service.js';
import { VendorCreditsService } from '../src/purchases/vendor-credits.service.js';
import { VendorsService } from '../src/purchases/vendors.service.js';
import { createTestHarness, type TestHarness } from './support/app.js';

const metadata = {
  ipHash: 'bills-test',
  userAgent: 'RetailBooks integration test',
};

describe('bill posting against a real database', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let periods: FiscalPeriodsService;
  let ledger: LedgerService;
  let tax: TaxService;
  let vendors: VendorsService;
  let purchaseOrders: PurchaseOrdersService;
  let bills: BillsService;
  let vendorCredits: VendorCreditsService;
  let owner: PublicUser;
  let context: OrganizationContext;
  let vendorId: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
    periods = harness.app.get(FiscalPeriodsService);
    ledger = harness.app.get(LedgerService);
    tax = harness.app.get(TaxService);
    vendors = harness.app.get(VendorsService);
    purchaseOrders = harness.app.get(PurchaseOrdersService);
    bills = harness.app.get(BillsService);
    vendorCredits = harness.app.get(VendorCreditsService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    const user = await harness.prisma.user.create({
      data: {
        email: 'bills-owner@example.test',
        displayName: 'Bills Owner',
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
      { legalName: 'Bill Books Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    const draftContext = await access.requireMembership(owner.id, created.id);
    await organizations.finalize(draftContext, owner, metadata);
    context = await access.requireMembership(owner.id, created.id);
    await periods.generateFiscalYear(context, owner, { startsOn: '2026-01-01' }, metadata);

    const vendor = await vendors.create(context, owner, { displayName: 'Acme Supplies' }, metadata);
    vendorId = vendor.id;
  });

  it('posts a balanced AP/expense/tax journal for a multi-tax-code bill', async () => {
    const codeA = await tax.createTaxCode(
      context,
      owner,
      { code: 'VAT-A', name: 'VAT A', treatment: 'EXCLUSIVE', recoverable: true },
      metadata,
    );
    await tax.createRate(
      context,
      owner,
      codeA.id,
      { ratePercent: '10', effectiveFrom: '2026-01-01' },
      metadata,
    );
    const codeB = await tax.createTaxCode(
      context,
      owner,
      { code: 'VAT-B', name: 'VAT B', treatment: 'EXCLUSIVE', recoverable: true },
      metadata,
    );
    await tax.createRate(
      context,
      owner,
      codeB.id,
      { ratePercent: '5', effectiveFrom: '2026-01-01' },
      metadata,
    );

    const draft = await bills.createDraft(
      context,
      owner,
      {
        vendorId,
        lines: [
          {
            description: 'Raw material A',
            quantity: '2',
            unitPriceMinor: '10000',
            taxCodeId: codeA.id,
          },
          {
            description: 'Raw material B',
            quantity: '1',
            unitPriceMinor: '5000',
            taxCodeId: codeB.id,
          },
        ],
      },
      metadata,
    );

    // Line 1: 2 * 10000 = 20000 taxable @ 10% = 2000 tax. Line 2: 1 * 5000 = 5000 taxable @ 5% = 250 tax.
    // subtotal = 20000 + 5000 = 25000; tax = 2000 + 250 = 2250; total = 27250.
    const issued = await bills.issueBill(context, owner, draft.id, metadata);
    expect(issued.status).toBe('ISSUED');
    expect(issued.subtotalMinor).toBe('25000');
    expect(issued.taxTotalMinor).toBe('2250');
    expect(issued.totalMinor).toBe('27250');
    expect(issued.balanceMinor).toBe('27250');
    expect(issued.billNumber).toMatch(/^BILL-/);

    const journal = await harness.prisma.journal.findFirstOrThrow({
      where: { id: issued.journalId! },
      include: { lines: true },
    });
    const debitTotal = journal.lines.reduce((sum, line) => sum + line.debitMinor, 0n);
    const creditTotal = journal.lines.reduce((sum, line) => sum + line.creditMinor, 0n);
    expect(debitTotal).toBe(creditTotal);
    expect(debitTotal).toBe(27250n);

    const apAccount = await ledger.accountBySystemKey(context.id, 'accounts_payable');
    const expenseAccount = await ledger.accountBySystemKey(context.id, 'general_expense');
    const taxAccount = await ledger.accountBySystemKey(context.id, 'tax_receivable');

    const apLine = journal.lines.find((line) => line.accountId === apAccount.id);
    expect(apLine?.creditMinor).toBe(27250n);

    const expenseLine = journal.lines.find((line) => line.accountId === expenseAccount.id);
    expect(expenseLine?.debitMinor).toBe(25000n);

    const taxLines = journal.lines.filter((line) => line.accountId === taxAccount.id);
    expect(taxLines).toHaveLength(2);
    expect(taxLines.map((line) => line.debitMinor).sort()).toEqual([250n, 2000n].sort());
  });

  it('rejects issuing an already-issued bill', async () => {
    const draft = await bills.createDraft(
      context,
      owner,
      { vendorId, lines: [{ description: 'Widget', quantity: '1', unitPriceMinor: '1000' }] },
      metadata,
    );
    await bills.issueBill(context, owner, draft.id, metadata);

    await expect(bills.issueBill(context, owner, draft.id, metadata)).rejects.toThrow(
      'Only draft bills can be issued',
    );
  });

  it('rejects creating a bill against a deactivated vendor', async () => {
    await vendors.setStatus(context, owner, vendorId, 'INACTIVE', metadata);

    await expect(
      bills.createDraft(
        context,
        owner,
        { vendorId, lines: [{ description: 'Widget', quantity: '1', unitPriceMinor: '1000' }] },
        metadata,
      ),
    ).rejects.toThrow('deactivated vendor');
  });

  it('rejects a bill line referencing an inactive item', async () => {
    const item = await harness.prisma.item.create({
      data: {
        organizationId: context.id,
        sku: 'RM-001',
        name: 'Discontinued Material',
        itemType: 'GOODS',
        status: 'INACTIVE',
        freeDescriptionAllowed: true,
      },
    });

    await expect(
      bills.createDraft(
        context,
        owner,
        { vendorId, lines: [{ itemId: item.id, quantity: '1', unitPriceMinor: '1000' }] },
        metadata,
      ),
    ).rejects.toThrow('item is not active');
  });

  it('rejects a bill line overriding the description of an item that disallows it', async () => {
    const item = await harness.prisma.item.create({
      data: {
        organizationId: context.id,
        sku: 'RM-002',
        name: 'Locked-description Material',
        itemType: 'GOODS',
        status: 'ACTIVE',
        freeDescriptionAllowed: false,
      },
    });

    await expect(
      bills.createDraft(
        context,
        owner,
        {
          vendorId,
          lines: [
            {
              itemId: item.id,
              description: 'Custom override',
              quantity: '1',
              unitPriceMinor: '1000',
            },
          ],
        },
        metadata,
      ),
    ).rejects.toThrow('does not allow a free-text description');
  });

  it('increments the linked purchase order billedMinor on issue and decrements it on void', async () => {
    const poDraft = await purchaseOrders.createDraft(
      context,
      owner,
      {
        vendorId,
        lines: [{ description: 'Bulk material', quantity: '1', unitPriceMinor: '5000' }],
      },
      metadata,
    );
    const approved = await purchaseOrders.approve(context, owner, poDraft.id, metadata);
    const po = await purchaseOrders.issue(context, owner, approved.id, metadata);
    expect(po.billedMinor).toBe('0');

    const billDraft = await bills.createDraft(
      context,
      owner,
      {
        vendorId,
        purchaseOrderId: po.id,
        lines: [{ description: 'Bulk material', quantity: '1', unitPriceMinor: '5000' }],
      },
      metadata,
    );
    const issuedBill = await bills.issueBill(context, owner, billDraft.id, metadata);
    expect(issuedBill.totalMinor).toBe('5000');

    const poAfterIssue = await harness.prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: po.id },
    });
    expect(poAfterIssue.billedMinor).toBe(5000n);

    await bills.voidBill(context, owner, issuedBill.id, metadata);

    const poAfterVoid = await harness.prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: po.id },
    });
    expect(poAfterVoid.billedMinor).toBe(0n);
  });

  it('voids an issued bill with an exact-reversal journal', async () => {
    const draft = await bills.createDraft(
      context,
      owner,
      { vendorId, lines: [{ description: 'Widget', quantity: '1', unitPriceMinor: '1000' }] },
      metadata,
    );
    const issued = await bills.issueBill(context, owner, draft.id, metadata);

    const voided = await bills.voidBill(context, owner, issued.id, metadata);
    expect(voided.status).toBe('VOID');

    const originalJournal = await harness.prisma.journal.findFirstOrThrow({
      where: { id: issued.journalId! },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    expect(originalJournal.status).toBe('REVERSED');

    const reversalJournal = await harness.prisma.journal.findFirstOrThrow({
      where: { reversalOfJournalId: originalJournal.id },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    expect(reversalJournal.status).toBe('POSTED');
    for (const [index, line] of originalJournal.lines.entries()) {
      const reversedLine = reversalJournal.lines[index]!;
      expect(reversedLine.accountId).toBe(line.accountId);
      expect(reversedLine.debitMinor).toBe(line.creditMinor);
      expect(reversedLine.creditMinor).toBe(line.debitMinor);
    }
  });

  it('rejects voiding a bill that has payments applied, directing to a vendor credit instead', async () => {
    const draft = await bills.createDraft(
      context,
      owner,
      { vendorId, lines: [{ description: 'Widget', quantity: '1', unitPriceMinor: '1000' }] },
      metadata,
    );
    const issued = await bills.issueBill(context, owner, draft.id, metadata);

    const vcDraft = await vendorCredits.createDraft(
      context,
      owner,
      {
        vendorId,
        lines: [{ description: 'Partial return', quantity: '1', unitPriceMinor: '400' }],
      },
      metadata,
    );
    const vendorCredit = await vendorCredits.issueVendorCredit(
      context,
      owner,
      vcDraft.id,
      metadata,
    );
    await vendorCredits.allocate(
      context,
      owner,
      vendorCredit.id,
      { allocations: [{ billId: issued.id, amountMinor: '400' }] },
      metadata,
    );

    await expect(bills.voidBill(context, owner, issued.id, metadata)).rejects.toThrow(
      'issue a vendor credit instead',
    );
  });
});
