import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PublicUser } from '../src/auth/auth.service.js';
import { FiscalPeriodsService } from '../src/organizations/fiscal-periods.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import type { OrganizationContext } from '../src/organizations/organization-context.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { RecurringBillsService } from '../src/purchases/recurring-bills.service.js';
import { VendorsService } from '../src/purchases/vendors.service.js';
import { createTestHarness, type TestHarness } from './support/app.js';

const metadata = {
  ipHash: 'recurring-bills-test',
  userAgent: 'RetailBooks integration test',
};

describe('recurring bill generation against a real database', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let periods: FiscalPeriodsService;
  let vendors: VendorsService;
  let recurringBills: RecurringBillsService;
  let owner: PublicUser;
  let context: OrganizationContext;
  let vendorId: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
    periods = harness.app.get(FiscalPeriodsService);
    vendors = harness.app.get(VendorsService);
    recurringBills = harness.app.get(RecurringBillsService);
  });

  afterAll(async () => {
    await harness.close();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(async () => {
    await harness.reset();
    const user = await harness.prisma.user.create({
      data: {
        email: 'recurring-bills-owner@example.test',
        displayName: 'Recurring Bills Owner',
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
      { legalName: 'Recurring Purchases Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    const draftContext = await access.requireMembership(owner.id, created.id);
    await organizations.finalize(draftContext, owner, metadata);
    context = await access.requireMembership(owner.id, created.id);
    await periods.generateFiscalYear(context, owner, { startsOn: '2026-01-01' }, metadata);

    const vendor = await vendors.create(context, owner, { displayName: 'Acme Supplies' }, metadata);
    vendorId = vendor.id;
  });

  it('generates exactly one bill for a due template, matching its lines, and advances nextRunDate', async () => {
    const template = await recurringBills.createTemplate(
      context,
      owner,
      {
        vendorId,
        cadence: 'MONTHLY',
        startDate: '2026-01-15',
        lines: [{ description: 'Office rent', quantity: '1', unitPriceMinor: '2500' }],
      },
      metadata,
    );
    expect(template.nextRunDate).toBe('2026-01-15');

    const results = await recurringBills.runDueTemplates(context, owner, metadata);
    expect(results).toHaveLength(1);
    expect(results[0]!.templateId).toBe(template.id);
    expect(results[0]!.billId).toBeTruthy();

    const bill = await harness.prisma.bill.findUniqueOrThrow({
      where: { id: results[0]!.billId! },
      include: { lines: true },
    });
    expect(bill.status).toBe('ISSUED');
    expect(bill.subtotalMinor).toBe(2500n);
    expect(bill.lines).toHaveLength(1);
    expect(bill.lines[0]!.descriptionSnapshot).toBe('Office rent');

    const updatedTemplate = await recurringBills.detail(context.id, template.id);
    expect(updatedTemplate.nextRunDate).toBe('2026-02-15');
  });

  it('skips a template whose nextRunDate has not arrived yet', async () => {
    const template = await recurringBills.createTemplate(
      context,
      owner,
      {
        vendorId,
        cadence: 'MONTHLY',
        startDate: '2099-01-15',
        lines: [{ description: 'Office rent', quantity: '1', unitPriceMinor: '2500' }],
      },
      metadata,
    );

    const results = await recurringBills.runDueTemplates(context, owner, metadata);
    expect(results).toHaveLength(0);

    const billCount = await harness.prisma.bill.count({ where: { organizationId: context.id } });
    expect(billCount).toBe(0);

    const updatedTemplate = await recurringBills.detail(context.id, template.id);
    expect(updatedTemplate.nextRunDate).toBe('2099-01-15');
  });

  it('produces a draft-only bill when autoCreate is false', async () => {
    const template = await recurringBills.createTemplate(
      context,
      owner,
      {
        vendorId,
        cadence: 'MONTHLY',
        startDate: '2026-01-15',
        autoCreate: false,
        lines: [{ description: 'Office rent', quantity: '1', unitPriceMinor: '2500' }],
      },
      metadata,
    );

    const results = await recurringBills.runDueTemplates(context, owner, metadata);
    expect(results).toHaveLength(1);
    expect(results[0]!.templateId).toBe(template.id);

    const bill = await harness.prisma.bill.findUniqueOrThrow({
      where: { id: results[0]!.billId! },
    });
    expect(bill.status).toBe('DRAFT');
  });

  it('clamps a month-end start date to the last valid day of the next month instead of overflowing', async () => {
    const template = await recurringBills.createTemplate(
      context,
      owner,
      {
        vendorId,
        cadence: 'MONTHLY',
        startDate: '2026-01-31',
        lines: [{ description: 'Office rent', quantity: '1', unitPriceMinor: '2500' }],
      },
      metadata,
    );
    expect(template.nextRunDate).toBe('2026-01-31');

    const results = await recurringBills.runDueTemplates(context, owner, metadata);
    expect(results).toHaveLength(1);

    const updatedTemplate = await recurringBills.detail(context.id, template.id);
    // February 2026 has 28 days -- Date.prototype.setUTCMonth would otherwise overflow Jan 31 + 1
    // month into 2026-03-03 rather than clamping to the last valid day of February.
    expect(updatedTemplate.nextRunDate).toBe('2026-02-28');
  });

  it('deactivates a template whose next occurrence after generation would exceed endDate', async () => {
    const template = await recurringBills.createTemplate(
      context,
      owner,
      {
        vendorId,
        cadence: 'WEEKLY',
        startDate: '2026-01-01',
        endDate: '2026-01-05',
        lines: [{ description: 'Weekly delivery', quantity: '1', unitPriceMinor: '1000' }],
      },
      metadata,
    );

    const results = await recurringBills.runDueTemplates(context, owner, metadata);
    expect(results).toHaveLength(1);

    const updatedTemplate = await recurringBills.detail(context.id, template.id);
    // startDate + 1 week = 2026-01-08, which is past the 2026-01-05 endDate.
    expect(updatedTemplate.nextRunDate).toBe('2026-01-08');
    expect(updatedTemplate.active).toBe(false);

    // A second sweep must not pick the now-inactive template back up.
    const secondRun = await recurringBills.runDueTemplates(context, owner, metadata);
    expect(secondRun).toHaveLength(0);

    const billCount = await harness.prisma.bill.count({
      where: { organizationId: context.id, vendorId },
    });
    expect(billCount).toBe(1);
  });

  it('concurrent double-trigger of runDueTemplates produces exactly one child bill for the same due template', async () => {
    const template = await recurringBills.createTemplate(
      context,
      owner,
      {
        vendorId,
        cadence: 'MONTHLY',
        startDate: '2026-01-15',
        lines: [{ description: 'Office rent', quantity: '1', unitPriceMinor: '2500' }],
      },
      metadata,
    );

    const [first, second] = await Promise.all([
      recurringBills.runDueTemplates(context, owner, metadata),
      recurringBills.runDueTemplates(context, owner, metadata),
    ]);

    const generatedBillIds = [...first, ...second]
      .filter((result) => result.billId)
      .map((result) => result.billId!);
    expect(generatedBillIds).toHaveLength(1);

    const billCount = await harness.prisma.bill.count({
      where: { organizationId: context.id, vendorId },
    });
    expect(billCount).toBe(1);

    const updatedTemplate = await recurringBills.detail(context.id, template.id);
    expect(updatedTemplate.nextRunDate).toBe('2026-02-15');

    const claimCount = await harness.prisma.ledgerIdempotencyKey.count({
      where: { organizationId: context.id, operation: 'RECURRING_BILL_GENERATE' },
    });
    expect(claimCount).toBe(1);
  });

  it('rejects creating a template for a deactivated vendor', async () => {
    await vendors.setStatus(context, owner, vendorId, 'INACTIVE', metadata);

    await expect(
      recurringBills.createTemplate(
        context,
        owner,
        {
          vendorId,
          cadence: 'MONTHLY',
          startDate: '2026-01-15',
          lines: [{ description: 'Office rent', quantity: '1', unitPriceMinor: '2500' }],
        },
        metadata,
      ),
    ).rejects.toThrow('Cannot create a recurring template for a deactivated vendor.');
  });

  it('rejects updating a template onto a deactivated vendor', async () => {
    const template = await recurringBills.createTemplate(
      context,
      owner,
      {
        vendorId,
        cadence: 'MONTHLY',
        startDate: '2026-01-15',
        lines: [{ description: 'Office rent', quantity: '1', unitPriceMinor: '2500' }],
      },
      metadata,
    );
    const otherVendor = await vendors.create(
      context,
      owner,
      { displayName: 'Deactivated Co' },
      metadata,
    );
    await vendors.setStatus(context, owner, otherVendor.id, 'INACTIVE', metadata);

    await expect(
      recurringBills.updateTemplate(
        context,
        owner,
        template.id,
        { vendorId: otherVendor.id },
        metadata,
      ),
    ).rejects.toThrow('Cannot use a deactivated vendor.');
  });

  it('updates, deactivates, and reactivates a template', async () => {
    const template = await recurringBills.createTemplate(
      context,
      owner,
      {
        vendorId,
        cadence: 'MONTHLY',
        startDate: '2026-01-15',
        lines: [{ description: 'Office rent', quantity: '1', unitPriceMinor: '2500' }],
      },
      metadata,
    );

    const updated = await recurringBills.updateTemplate(
      context,
      owner,
      template.id,
      {
        cadence: 'QUARTERLY',
        autoCreate: false,
        lines: [{ description: 'Office rent (revised)', quantity: '2', unitPriceMinor: '1500' }],
      },
      metadata,
    );
    expect(updated.cadence).toBe('QUARTERLY');
    expect(updated.autoCreate).toBe(false);
    expect(updated.lines).toHaveLength(1);
    expect(updated.lines[0]!.descriptionSnapshot).toBe('Office rent (revised)');

    const deactivated = await recurringBills.deactivate(context, owner, template.id, metadata);
    expect(deactivated.active).toBe(false);

    const reactivated = await recurringBills.reactivate(context, owner, template.id, metadata);
    expect(reactivated.active).toBe(true);
  });
});
