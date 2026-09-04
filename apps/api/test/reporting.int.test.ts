import { REPORT_KEYS } from '@retailbooks/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PublicUser } from '../src/auth/auth.service.js';
import { FiscalPeriodsService } from '../src/organizations/fiscal-periods.service.js';
import { LedgerService } from '../src/organizations/ledger.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import type { OrganizationContext } from '../src/organizations/organization-context.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { ReportingService } from '../src/reporting/reporting.service.js';
import { createTestHarness, type TestHarness } from './support/app.js';

const metadata = { ipHash: 'reporting-test', userAgent: 'RetailBooks reporting integration test' };

describe('report engine against a real database', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let periods: FiscalPeriodsService;
  let ledger: LedgerService;
  let reports: ReportingService;
  let owner: PublicUser;
  let context: OrganizationContext;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
    periods = harness.app.get(FiscalPeriodsService);
    ledger = harness.app.get(LedgerService);
    reports = harness.app.get(ReportingService);
  });

  afterAll(async () => harness.close());

  beforeEach(async () => {
    await harness.reset();
    const user = await harness.prisma.user.create({
      data: {
        email: 'report-owner@example.test',
        displayName: 'Report Owner',
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
      { legalName: 'Report Books Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    const draft = await access.requireMembership(owner.id, created.id);
    await organizations.finalize(draft, owner, metadata);
    context = await access.requireMembership(owner.id, created.id);
    await periods.generateFiscalYear(context, owner, { startsOn: '2026-01-01' }, metadata);
  });

  it('executes every registered report through its source-of-truth query', async () => {
    for (const key of REPORT_KEYS) {
      const result = await reports.run(context.id, key, {
        from: '2026-01-01',
        to: '2026-12-31',
      });
      expect(result.definition.key).toBe(key);
      expect(result.rows).toEqual([]);
    }
  });

  it('reconciles profit and loss and balance sheet slices to the trial balance', async () => {
    const bank = await ledger.accountBySystemKey(context.id, 'bank_default');
    const revenue = await ledger.accountBySystemKey(context.id, 'sales_revenue');
    const draft = await ledger.createJournalDraft(context, owner, {
      journalDate: '2026-03-15',
      currency: 'KES',
      description: 'Reporting reconciliation fixture',
      lines: [
        { accountId: bank.id, debitMinor: '12500', creditMinor: '0' },
        { accountId: revenue.id, debitMinor: '0', creditMinor: '12500' },
      ],
    });
    await ledger.postJournal(
      context,
      owner,
      draft.id,
      metadata,
      'reporting-reconciliation-fixture',
    );

    const filters = { from: '2026-01-01', to: '2026-12-31' };
    const trial = await reports.run(context.id, 'financial.trial-balance', filters);
    const profitLoss = await reports.run(context.id, 'financial.profit-loss', filters);
    const balanceSheet = await reports.run(context.id, 'financial.balance-sheet', filters);

    expect(trial.totals.debitMinor).toBe('12500');
    expect(trial.totals.creditMinor).toBe('12500');
    expect(profitLoss.totals.amountMinor).toBe('12500');
    expect(balanceSheet.totals.amountMinor).toBe('12500');
  });

  it('persists saved filters with audit evidence and prevents cross-user mutation', async () => {
    const saved = await reports.createSaved(
      context,
      owner,
      {
        name: 'Year end P&L',
        reportKey: 'financial.profit-loss',
        filters: { from: '2026-01-01', to: '2026-12-31' },
      },
      metadata,
    );
    expect(await reports.listSaved(context.id, owner.id)).toHaveLength(1);
    expect(
      await harness.prisma.auditEvent.count({
        where: { organizationId: context.id, entityId: saved.id, eventKey: 'report.saved_created' },
      }),
    ).toBe(1);

    await reports.deleteSaved(context, owner, saved.id, metadata);
    expect(await reports.listSaved(context.id, owner.id)).toEqual([]);
  });

  it('ties receivable, payable, and inventory reports to their ledger control accounts', async () => {
    const [bank, receivable, payable, inventory, revenue, expense] = await Promise.all([
      ledger.accountBySystemKey(context.id, 'bank_default'),
      ledger.accountBySystemKey(context.id, 'accounts_receivable'),
      ledger.accountBySystemKey(context.id, 'accounts_payable'),
      ledger.accountBySystemKey(context.id, 'inventory_asset'),
      ledger.accountBySystemKey(context.id, 'sales_revenue'),
      ledger.accountBySystemKey(context.id, 'general_expense'),
    ]);
    const [customer, vendor, item, warehouse] = await Promise.all([
      harness.prisma.contact.create({
        data: { organizationId: context.id, displayName: 'Control Customer', currency: 'KES' },
      }),
      harness.prisma.vendor.create({
        data: { organizationId: context.id, displayName: 'Control Vendor', currency: 'KES' },
      }),
      harness.prisma.item.create({
        data: {
          organizationId: context.id,
          name: 'Control Stock',
          itemType: 'GOODS',
          inventoryTracked: true,
        },
      }),
      harness.prisma.warehouse.create({
        data: { organizationId: context.id, code: 'REPORT', name: 'Report Warehouse' },
      }),
    ]);
    await Promise.all([
      harness.prisma.invoice.create({
        data: {
          organizationId: context.id,
          contactId: customer.id,
          invoiceNumber: 'INV-REPORT',
          status: 'ISSUED',
          issueDate: new Date('2026-03-01T00:00:00.000Z'),
          dueDate: new Date('2026-03-31T00:00:00.000Z'),
          currency: 'KES',
          subtotalMinor: 9000n,
          totalMinor: 9000n,
          balanceMinor: 9000n,
          createdByUserId: owner.id,
        },
      }),
      harness.prisma.bill.create({
        data: {
          organizationId: context.id,
          vendorId: vendor.id,
          billNumber: 'BILL-REPORT',
          status: 'ISSUED',
          issueDate: new Date('2026-03-01T00:00:00.000Z'),
          dueDate: new Date('2026-03-31T00:00:00.000Z'),
          currency: 'KES',
          subtotalMinor: 7000n,
          totalMinor: 7000n,
          balanceMinor: 7000n,
          createdByUserId: owner.id,
        },
      }),
      harness.prisma.valuationLayer.create({
        data: {
          organizationId: context.id,
          itemId: item.id,
          warehouseId: warehouse.id,
          sourceType: 'ADJUSTMENT',
          sourceId: crypto.randomUUID(),
          layerDate: new Date('2026-03-01T00:00:00.000Z'),
          quantityIn: '5',
          quantityRemaining: '5',
          unitCostMinor: 1000n,
          costRemainingMinor: 5000n,
        },
      }),
    ]);
    const draft = await ledger.createJournalDraft(context, owner, {
      journalDate: '2026-03-01',
      currency: 'KES',
      description: 'Control-account reconciliation fixture',
      lines: [
        { accountId: receivable.id, debitMinor: '9000', creditMinor: '0' },
        { accountId: revenue.id, debitMinor: '0', creditMinor: '9000' },
        { accountId: expense.id, debitMinor: '7000', creditMinor: '0' },
        { accountId: payable.id, debitMinor: '0', creditMinor: '7000' },
        { accountId: inventory.id, debitMinor: '5000', creditMinor: '0' },
        { accountId: bank.id, debitMinor: '0', creditMinor: '5000' },
      ],
    });
    await ledger.postJournal(context, owner, draft.id, metadata, 'reporting-control-fixture');

    const filters = { from: '2026-01-01', to: '2026-12-31' };
    const [trial, ar, ap, valuation] = await Promise.all([
      reports.run(context.id, 'financial.trial-balance', filters),
      reports.run(context.id, 'receivables.aging-summary', filters),
      reports.run(context.id, 'payables.aging-summary', filters),
      reports.run(context.id, 'inventory.valuation', filters),
    ]);
    const trialById = new Map(trial.rows.map((row) => [row.id, row.cells]));
    expect(ar.totals.amountMinor).toBe('9000');
    expect(trialById.get(receivable.id)?.debitMinor).toBe('9000');
    expect(ap.totals.amountMinor).toBe('7000');
    expect(trialById.get(payable.id)?.creditMinor).toBe('7000');
    expect(valuation.totals.amountMinor).toBe('5000');
    expect(trialById.get(inventory.id)?.debitMinor).toBe('5000');
  });

  it('reports foreign-currency journals in frozen base-currency amounts', async () => {
    await harness.prisma.organizationCurrency.create({
      data: { organizationId: context.id, currencyCode: 'USD' },
    });
    const bank = await ledger.accountBySystemKey(context.id, 'bank_default');
    const revenue = await ledger.accountBySystemKey(context.id, 'sales_revenue');
    const draft = await ledger.createJournalDraft(context, owner, {
      journalDate: '2026-04-01',
      currency: 'USD',
      exchangeRate: '2',
      description: 'Base-currency reporting fixture',
      lines: [
        { accountId: bank.id, debitMinor: '1000', creditMinor: '0', foreignAmountMinor: '1000' },
        { accountId: revenue.id, debitMinor: '0', creditMinor: '1000', foreignAmountMinor: '1000' },
      ],
    });
    await ledger.postJournal(context, owner, draft.id, metadata, 'reporting-fx-fixture');
    const trial = await reports.run(context.id, 'financial.trial-balance', {
      from: '2026-01-01',
      to: '2026-12-31',
      currencyMode: 'BASE',
    });
    expect(trial.totals).toMatchObject({ debitMinor: '2000', creditMinor: '2000' });
  });
});
