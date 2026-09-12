import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PublicUser } from '../src/auth/auth.service.js';
import { FiscalPeriodsService } from '../src/organizations/fiscal-periods.service.js';
import { LedgerService } from '../src/organizations/ledger.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { TaxService } from '../src/organizations/tax.service.js';
import { BillsService } from '../src/purchases/bills.service.js';
import { ExpensesService } from '../src/purchases/expenses.service.js';
import { VendorsService } from '../src/purchases/vendors.service.js';
import { CustomersService } from '../src/sales/customers.service.js';
import { InvoicesService } from '../src/sales/invoices.service.js';
import { createTestHarness, type TestHarness } from './support/app.js';

const metadata = {
  ipHash: 'optimistic-concurrency-test',
  userAgent: 'RetailBooks integration test',
};

describe('optimistic concurrency on financial documents (GAPS #35)', () => {
  let harness: TestHarness;
  let invoices: InvoicesService;
  let bills: BillsService;
  let expenses: ExpensesService;
  let paidThroughAccountId: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    invoices = harness.app.get(InvoicesService);
    bills = harness.app.get(BillsService);
    expenses = harness.app.get(ExpensesService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
  });
  /** Seed org + tax + customer for invoice tests. */
  async function setupInvoiceOrg() {
    const organizations = harness.app.get(OrganizationService);
    const access = harness.app.get(OrganizationAccessService);
    const periods = harness.app.get(FiscalPeriodsService);
    const tax = harness.app.get(TaxService);
    const customers = harness.app.get(CustomersService);

    const user = await harness.prisma.user.create({
      data: {
        email: 'oc-owner@example.test',
        displayName: 'OC Owner',
        emailVerifiedAt: new Date(),
        status: 'ACTIVE',
      },
    });
    const owner: PublicUser = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      emailVerified: true,
      status: user.status,
    };

    const created = await organizations.create(
      owner,
      { legalName: 'Concurrency Inc', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    const draftContext = await access.requireMembership(owner.id, created.id);
    await organizations.finalize(draftContext, owner, metadata);
    const context = await access.requireMembership(owner.id, created.id);
    await periods.generateFiscalYear(context, owner, { startsOn: '2026-01-01' }, metadata);

    const code = await tax.createTaxCode(
      context,
      owner,
      { code: 'VAT', name: 'VAT', treatment: 'EXCLUSIVE', recoverable: true },
      metadata,
    );
    await tax.createRate(
      context,
      owner,
      code.id,
      { ratePercent: '16', effectiveFrom: '2026-01-01' },
      metadata,
    );
    const contact = await customers.create(
      context,
      owner,
      { displayName: 'Test Customer' },
      metadata,
    );
    return { owner, context, contactId: contact.id, taxCodeId: code.id };
  }

  /** Seed org + tax + vendor for bill/expense tests. */
  async function setupBillOrg() {
    const organizations = harness.app.get(OrganizationService);
    const access = harness.app.get(OrganizationAccessService);
    const periods = harness.app.get(FiscalPeriodsService);
    const tax = harness.app.get(TaxService);
    const vendors = harness.app.get(VendorsService);
    const ledger = harness.app.get(LedgerService);

    const user = await harness.prisma.user.create({
      data: {
        email: 'oc-vendor@example.test',
        displayName: 'OC Vendor',
        emailVerifiedAt: new Date(),
        status: 'ACTIVE',
      },
    });
    const owner: PublicUser = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      emailVerified: true,
      status: user.status,
    };

    const created = await organizations.create(
      owner,
      { legalName: 'Bill Inc', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    const draftContext = await access.requireMembership(owner.id, created.id);
    await organizations.finalize(draftContext, owner, metadata);
    const context = await access.requireMembership(owner.id, created.id);
    await periods.generateFiscalYear(context, owner, { startsOn: '2026-01-01' }, metadata);

    const code = await tax.createTaxCode(
      context,
      owner,
      { code: 'VAT', name: 'VAT', treatment: 'EXCLUSIVE', recoverable: true },
      metadata,
    );
    await tax.createRate(
      context,
      owner,
      code.id,
      { ratePercent: '16', effectiveFrom: '2026-01-01' },
      metadata,
    );
    const vendor = await vendors.create(context, owner, { displayName: 'Test Vendor' }, metadata);
    paidThroughAccountId = (await ledger.accountBySystemKey(context.id, 'bank_default')).id;
    return { owner, context, vendorId: vendor.id, taxCodeId: code.id };
  }
  it('rejects a stale invoice update when the version does not match', async () => {
    const { owner, context, contactId } = await setupInvoiceOrg();

    const draft = await invoices.createDraft(
      context,
      owner,
      { contactId, lines: [{ description: 'Widget', quantity: '1', unitPriceMinor: '1000' }] },
      metadata,
    );
    expect(draft.version).toBe(0);

    // Simulate a concurrent write that bumps the version.
    await harness.prisma.invoice.update({
      where: { id: draft.id },
      data: { version: { increment: 1 } },
    });

    // The stale update - based on version 0 - must fail.
    await expect(
      invoices.updateDraft(
        context,
        owner,
        draft.id,
        { version: 0, lines: [{ description: 'Widget', quantity: '2', unitPriceMinor: '1000' }] },
        metadata,
      ),
    ).rejects.toThrow();

    // A correct update (version 1) succeeds and increments the counter.
    const updated = await invoices.updateDraft(
      context,
      owner,
      draft.id,
      { version: 1, lines: [{ description: 'Widget', quantity: '2', unitPriceMinor: '1000' }] },
      metadata,
    );
    expect(updated.version).toBe(2);
  });

  it('allows an unversioned invoice update for backward compatibility', async () => {
    const { owner, context, contactId } = await setupInvoiceOrg();

    const draft = await invoices.createDraft(
      context,
      owner,
      { contactId, lines: [{ description: 'Widget', quantity: '1', unitPriceMinor: '1000' }] },
      metadata,
    );

    const updated = await invoices.updateDraft(
      context,
      owner,
      draft.id,
      { lines: [{ description: 'Updated Widget', quantity: '1', unitPriceMinor: '1000' }] },
      metadata,
    );
    expect(updated.version).toBe(1);
  });
  it('rejects a stale bill update when the version does not match', async () => {
    const { owner, context, vendorId, taxCodeId } = await setupBillOrg();

    const draft = await bills.createDraft(
      context,
      owner,
      {
        vendorId,
        currency: 'KES',
        lines: [{ description: 'Service', quantity: '1', unitPriceMinor: '5000', taxCodeId }],
      },
      metadata,
    );

    await harness.prisma.bill.update({
      where: { id: draft.id },
      data: { version: { increment: 1 } },
    });

    await expect(
      bills.updateDraft(
        context,
        owner,
        draft.id,
        {
          version: 0,
          lines: [{ description: 'Service', quantity: '1', unitPriceMinor: '6000', taxCodeId }],
        },
        metadata,
      ),
    ).rejects.toThrow();

    const updated = await bills.updateDraft(
      context,
      owner,
      draft.id,
      {
        version: 1,
        lines: [{ description: 'Service', quantity: '1', unitPriceMinor: '6000', taxCodeId }],
      },
      metadata,
    );
    expect(updated.version).toBe(2);
  });

  it('rejects a stale expense update when the version does not match', async () => {
    const { owner, context, vendorId, taxCodeId } = await setupBillOrg();

    const draft = await expenses.createDraft(
      context,
      owner,
      {
        payeeVendorId: vendorId,
        expenseDate: '2026-06-01',
        paidThroughAccountId,
        amountMinor: '1000',
        taxCodeId,
      },
      metadata,
    );

    await harness.prisma.expense.update({
      where: { id: draft.id },
      data: { version: { increment: 1 } },
    });

    await expect(
      expenses.updateDraft(context, owner, draft.id, { version: 0, amountMinor: '2000' }, metadata),
    ).rejects.toThrow();

    const updated = await expenses.updateDraft(
      context,
      owner,
      draft.id,
      { version: 1, amountMinor: '2000' },
      metadata,
    );
    expect(updated.version).toBe(2);
  });
});
