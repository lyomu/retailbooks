import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PublicUser } from '../src/auth/auth.service.js';
import { FiscalPeriodsService } from '../src/organizations/fiscal-periods.service.js';
import { LedgerService } from '../src/organizations/ledger.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import type { OrganizationContext } from '../src/organizations/organization-context.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { BillsService } from '../src/purchases/bills.service.js';
import { PaymentsMadeService } from '../src/purchases/payments-made.service.js';
import { VendorsService } from '../src/purchases/vendors.service.js';
import { createTestHarness, type TestHarness } from './support/app.js';

const metadata = {
  ipHash: 'payments-made-test',
  userAgent: 'RetailBooks integration test',
};

describe('vendor payment recording and allocation against a real database', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let periods: FiscalPeriodsService;
  let ledger: LedgerService;
  let vendors: VendorsService;
  let bills: BillsService;
  let paymentsMade: PaymentsMadeService;
  let owner: PublicUser;
  let context: OrganizationContext;
  let vendorId: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
    periods = harness.app.get(FiscalPeriodsService);
    ledger = harness.app.get(LedgerService);
    vendors = harness.app.get(VendorsService);
    bills = harness.app.get(BillsService);
    paymentsMade = harness.app.get(PaymentsMadeService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    const user = await harness.prisma.user.create({
      data: {
        email: 'payments-made-owner@example.test',
        displayName: 'Payments Made Owner',
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
      { legalName: 'Payment Made Books Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    const draftContext = await access.requireMembership(owner.id, created.id);
    await organizations.finalize(draftContext, owner, metadata);
    context = await access.requireMembership(owner.id, created.id);
    await periods.generateFiscalYear(context, owner, { startsOn: '2026-01-01' }, metadata);

    const vendor = await vendors.create(context, owner, { displayName: 'Acme Supplies' }, metadata);
    vendorId = vendor.id;
  });

  async function issuedBillFor(vendorIdForBill: string, unitPriceMinor: string) {
    const draft = await bills.createDraft(
      context,
      owner,
      {
        vendorId: vendorIdForBill,
        lines: [{ description: 'Widget stock', quantity: '1', unitPriceMinor }],
      },
      metadata,
    );
    return bills.issueBill(context, owner, draft.id, metadata);
  }

  function issuedBill(unitPriceMinor: string) {
    return issuedBillFor(vendorId, unitPriceMinor);
  }

  it('records a balanced AP/bank journal when recording a payment', async () => {
    const payment = await paymentsMade.record(
      context,
      owner,
      { vendorId, paidDate: '2026-02-01', amountMinor: '1500' },
      metadata,
    );
    expect(payment.status).toBe('UNAPPLIED');
    expect(payment.unappliedMinor).toBe('1500');
    expect(payment.allocatedMinor).toBe('0');
    expect(payment.paymentNumber).toMatch(/^PMD-/);

    const journal = await harness.prisma.journal.findFirstOrThrow({
      where: { id: payment.journalId! },
      include: { lines: true },
    });
    const debitTotal = journal.lines.reduce((sum, line) => sum + line.debitMinor, 0n);
    const creditTotal = journal.lines.reduce((sum, line) => sum + line.creditMinor, 0n);
    expect(debitTotal).toBe(creditTotal);
    expect(debitTotal).toBe(1500n);

    const bankAccount = await ledger.accountBySystemKey(context.id, 'bank_default');
    const apAccount = await ledger.accountBySystemKey(context.id, 'accounts_payable');
    const apLine = journal.lines.find((line) => line.accountId === apAccount.id);
    expect(apLine?.debitMinor).toBe(1500n);
    const bankLine = journal.lines.find((line) => line.accountId === bankAccount.id);
    expect(bankLine?.creditMinor).toBe(1500n);
  });

  it('rejects recording a payment for a deactivated vendor', async () => {
    await vendors.setStatus(context, owner, vendorId, 'INACTIVE', metadata);

    await expect(
      paymentsMade.record(
        context,
        owner,
        { vendorId, paidDate: '2026-02-01', amountMinor: '1000' },
        metadata,
      ),
    ).rejects.toThrow('deactivated vendor');
  });

  it('rejects an allocation that exceeds a single bill balance, atomically', async () => {
    const bill = await issuedBill('1000');
    const payment = await paymentsMade.record(
      context,
      owner,
      { vendorId, paidDate: '2026-02-01', amountMinor: '2000' },
      metadata,
    );

    await expect(
      paymentsMade.allocate(
        context,
        owner,
        payment.id,
        { allocations: [{ billId: bill.id, amountMinor: '1500' }] },
        metadata,
      ),
    ).rejects.toThrow('exceeds its remaining balance');

    const billAfter = await harness.prisma.bill.findUniqueOrThrow({ where: { id: bill.id } });
    expect(billAfter.balanceMinor).toBe(1000n);
    const paymentAfter = await harness.prisma.paymentMade.findUniqueOrThrow({
      where: { id: payment.id },
    });
    expect(paymentAfter.unappliedMinor).toBe(2000n);
  });

  it('rejects an allocation whose total exceeds unappliedMinor even though no single bill is over its own balance', async () => {
    const billA = await issuedBill('1000');
    const billB = await issuedBill('1000');
    const payment = await paymentsMade.record(
      context,
      owner,
      { vendorId, paidDate: '2026-02-01', amountMinor: '1500' },
      metadata,
    );

    await expect(
      paymentsMade.allocate(
        context,
        owner,
        payment.id,
        {
          allocations: [
            { billId: billA.id, amountMinor: '1000' },
            { billId: billB.id, amountMinor: '800' },
          ],
        },
        metadata,
      ),
    ).rejects.toThrow("exceeds the payment's unapplied amount");

    const billAAfter = await harness.prisma.bill.findUniqueOrThrow({ where: { id: billA.id } });
    const billBAfter = await harness.prisma.bill.findUniqueOrThrow({ where: { id: billB.id } });
    expect(billAAfter.balanceMinor).toBe(1000n);
    expect(billBAfter.balanceMinor).toBe(1000n);
    expect(
      await harness.prisma.paymentMadeAllocation.count({ where: { paymentId: payment.id } }),
    ).toBe(0);
  });

  it('derives PARTIALLY_PAID/PARTIALLY_ALLOCATED then PAID/FULLY_ALLOCATED across two allocation calls', async () => {
    const bill = await issuedBill('1000');
    const payment = await paymentsMade.record(
      context,
      owner,
      { vendorId, paidDate: '2026-02-01', amountMinor: '1000' },
      metadata,
    );

    const afterFirst = await paymentsMade.allocate(
      context,
      owner,
      payment.id,
      { allocations: [{ billId: bill.id, amountMinor: '600' }] },
      metadata,
    );
    expect(afterFirst.status).toBe('PARTIALLY_ALLOCATED');
    const billAfterFirst = await harness.prisma.bill.findUniqueOrThrow({ where: { id: bill.id } });
    expect(billAfterFirst.status).toBe('PARTIALLY_PAID');
    expect(billAfterFirst.balanceMinor).toBe(400n);

    const afterSecond = await paymentsMade.allocate(
      context,
      owner,
      payment.id,
      { allocations: [{ billId: bill.id, amountMinor: '400' }] },
      metadata,
    );
    expect(afterSecond.status).toBe('FULLY_ALLOCATED');
    expect(afterSecond.unappliedMinor).toBe('0');
    const billAfterSecond = await harness.prisma.bill.findUniqueOrThrow({ where: { id: bill.id } });
    expect(billAfterSecond.status).toBe('PAID');
    expect(billAfterSecond.balanceMinor).toBe(0n);
  });

  it('concurrent allocation race: exactly one of two competing calls succeeds without letting balances go negative', async () => {
    const billA = await issuedBill('1000');
    const billB = await issuedBill('1000');
    const payment = await paymentsMade.record(
      context,
      owner,
      { vendorId, paidDate: '2026-02-01', amountMinor: '1200' },
      metadata,
    );

    const results = await Promise.allSettled([
      paymentsMade.allocate(
        context,
        owner,
        payment.id,
        { allocations: [{ billId: billA.id, amountMinor: '1000' }] },
        metadata,
      ),
      paymentsMade.allocate(
        context,
        owner,
        payment.id,
        { allocations: [{ billId: billB.id, amountMinor: '1000' }] },
        metadata,
      ),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);

    // Only one 1000 allocation can fit inside a 1200 unapplied balance -- the outcome is
    // deterministic regardless of which of the two competing calls wins the payment-row lock.
    const paymentAfter = await harness.prisma.paymentMade.findUniqueOrThrow({
      where: { id: payment.id },
    });
    expect(paymentAfter.allocatedMinor).toBe(1000n);
    expect(paymentAfter.unappliedMinor).toBe(200n);

    const billAAfter = await harness.prisma.bill.findUniqueOrThrow({ where: { id: billA.id } });
    const billBAfter = await harness.prisma.bill.findUniqueOrThrow({ where: { id: billB.id } });
    expect(billAAfter.balanceMinor >= 0n).toBe(true);
    expect(billBAfter.balanceMinor >= 0n).toBe(true);
    expect(billAAfter.balanceMinor + billBAfter.balanceMinor).toBe(1000n);
  });

  it('atomically replays a same-idempotency-key allocate request', async () => {
    const bill = await issuedBill('1000');
    const payment = await paymentsMade.record(
      context,
      owner,
      { vendorId, paidDate: '2026-02-01', amountMinor: '1000' },
      metadata,
    );

    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        paymentsMade
          .allocate(
            context,
            owner,
            payment.id,
            { allocations: [{ billId: bill.id, amountMinor: '1000' }] },
            metadata,
            'same-allocate-key',
          )
          .catch((error: unknown) => error),
      ),
    );
    const succeeded = responses.filter(
      (response): response is { id: string; status: string } =>
        typeof response === 'object' && response !== null && 'id' in response,
    );
    expect(succeeded).toHaveLength(6);

    expect(
      await harness.prisma.paymentMadeAllocation.count({
        where: { paymentId: payment.id, billId: bill.id },
      }),
    ).toBe(1);
    expect(
      await harness.prisma.ledgerIdempotencyKey.count({
        where: {
          organizationId: context.id,
          operation: 'PAYMENT_MADE_ALLOCATE',
          key: 'same-allocate-key',
        },
      }),
    ).toBe(1);
  });

  it('rejects allocating a bill that belongs to a different vendor than the payment', async () => {
    const otherVendor = await vendors.create(context, owner, { displayName: 'Other Co' }, metadata);
    const otherBill = await issuedBillFor(otherVendor.id, '1000');

    const payment = await paymentsMade.record(
      context,
      owner,
      { vendorId, paidDate: '2026-02-01', amountMinor: '1000' },
      metadata,
    );

    await expect(
      paymentsMade.allocate(
        context,
        owner,
        payment.id,
        { allocations: [{ billId: otherBill.id, amountMinor: '1000' }] },
        metadata,
      ),
    ).rejects.toThrow("does not belong to this payment's vendor");
  });
});
