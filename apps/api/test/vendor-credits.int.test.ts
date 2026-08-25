import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PublicUser } from '../src/auth/auth.service.js';
import { FiscalPeriodsService } from '../src/organizations/fiscal-periods.service.js';
import { LedgerService } from '../src/organizations/ledger.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import type { OrganizationContext } from '../src/organizations/organization-context.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { BillsService } from '../src/purchases/bills.service.js';
import { VendorCreditsService } from '../src/purchases/vendor-credits.service.js';
import { VendorsService } from '../src/purchases/vendors.service.js';
import { createTestHarness, type TestHarness } from './support/app.js';

const metadata = {
  ipHash: 'vendor-credits-test',
  userAgent: 'RetailBooks integration test',
};

describe('vendor credit issuing, allocation, and void against a real database', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let periods: FiscalPeriodsService;
  let ledger: LedgerService;
  let vendors: VendorsService;
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
    vendors = harness.app.get(VendorsService);
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
        email: 'vendor-credits-owner@example.test',
        displayName: 'Vendor Credits Owner',
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
      { legalName: 'Vendor Credit Books Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
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

  async function issuedVendorCredit(unitPriceMinor: string) {
    const draft = await vendorCredits.createDraft(
      context,
      owner,
      { vendorId, lines: [{ description: 'Return', quantity: '1', unitPriceMinor }] },
      metadata,
    );
    return vendorCredits.issueVendorCredit(context, owner, draft.id, metadata);
  }

  it('posts a balanced expense-credit, vendor_credit-debit journal when issuing', async () => {
    const vendorCredit = await issuedVendorCredit('1500');
    expect(vendorCredit.status).toBe('ISSUED');
    expect(vendorCredit.remainingMinor).toBe('1500');
    expect(vendorCredit.vendorCreditNumber).toMatch(/^VCR-/);

    const journal = await harness.prisma.journal.findFirstOrThrow({
      where: { id: vendorCredit.journalId! },
      include: { lines: true },
    });
    const debitTotal = journal.lines.reduce((sum, line) => sum + line.debitMinor, 0n);
    const creditTotal = journal.lines.reduce((sum, line) => sum + line.creditMinor, 0n);
    expect(debitTotal).toBe(creditTotal);
    expect(debitTotal).toBe(1500n);

    const expenseAccount = await ledger.accountBySystemKey(context.id, 'general_expense');
    const vendorCreditAccount = await ledger.accountBySystemKey(context.id, 'vendor_credit');
    const expenseLine = journal.lines.find((line) => line.accountId === expenseAccount.id);
    expect(expenseLine?.creditMinor).toBe(1500n);
    const debitLine = journal.lines.find((line) => line.accountId === vendorCreditAccount.id);
    expect(debitLine?.debitMinor).toBe(1500n);
  });

  it('rejects creating a vendor credit against a deactivated vendor', async () => {
    await vendors.setStatus(context, owner, vendorId, 'INACTIVE', metadata);

    await expect(
      vendorCredits.createDraft(
        context,
        owner,
        { vendorId, lines: [{ description: 'Return', quantity: '1', unitPriceMinor: '1000' }] },
        metadata,
      ),
    ).rejects.toThrow('deactivated vendor');
  });

  it('rejects an allocation that exceeds a single bill balance, atomically', async () => {
    const bill = await issuedBill('1000');
    const vendorCredit = await issuedVendorCredit('2000');

    await expect(
      vendorCredits.allocate(
        context,
        owner,
        vendorCredit.id,
        { allocations: [{ billId: bill.id, amountMinor: '1500' }] },
        metadata,
      ),
    ).rejects.toThrow('exceeds its remaining balance');

    const billAfter = await harness.prisma.bill.findUniqueOrThrow({ where: { id: bill.id } });
    expect(billAfter.balanceMinor).toBe(1000n);
    const vendorCreditAfter = await harness.prisma.vendorCredit.findUniqueOrThrow({
      where: { id: vendorCredit.id },
    });
    expect(vendorCreditAfter.remainingMinor).toBe(2000n);
  });

  it('rejects an allocation whose total exceeds the remaining balance even though no single bill is over its own balance', async () => {
    const billA = await issuedBill('1000');
    const billB = await issuedBill('1000');
    const vendorCredit = await issuedVendorCredit('1500');

    await expect(
      vendorCredits.allocate(
        context,
        owner,
        vendorCredit.id,
        {
          allocations: [
            { billId: billA.id, amountMinor: '1000' },
            { billId: billB.id, amountMinor: '800' },
          ],
        },
        metadata,
      ),
    ).rejects.toThrow("exceeds the vendor credit's remaining balance");

    const billAAfter = await harness.prisma.bill.findUniqueOrThrow({ where: { id: billA.id } });
    const billBAfter = await harness.prisma.bill.findUniqueOrThrow({ where: { id: billB.id } });
    expect(billAAfter.balanceMinor).toBe(1000n);
    expect(billBAfter.balanceMinor).toBe(1000n);
    expect(
      await harness.prisma.vendorCreditAllocation.count({
        where: { vendorCreditId: vendorCredit.id },
      }),
    ).toBe(0);
  });

  it('does not let a second allocation against the same bill double-count prior allocations from this vendor credit', async () => {
    // Regression coverage for the exact 2E-era bug: the per-bill guard must compare `amount`
    // directly against the freshly re-read `bill.balanceMinor` (already net of prior allocations),
    // never `existingAllocationFromThisVendorCredit + amount`. The vendor credit's own total is
    // kept deliberately large (2000) so the *whole-call* remaining-balance guard never fires here --
    // this test isolates the per-bill guard specifically.
    //
    // Bill balance 1000: allocate 600 (live balance -> 400), then allocate a further 300. Under the
    // buggy shape the guard would compare `existingAllocationFromThisVendorCredit + amount`
    // (600 + 300 = 900) against the live balanceMinor (400) and wrongly reject a perfectly legal
    // follow-up allocation, since 400 is already net of the first 600. The correct guard compares
    // `amount` (300) directly against the live balanceMinor (400), which passes.
    const bill = await issuedBill('1000');
    const vendorCredit = await issuedVendorCredit('2000');

    await vendorCredits.allocate(
      context,
      owner,
      vendorCredit.id,
      { allocations: [{ billId: bill.id, amountMinor: '600' }] },
      metadata,
    );

    await vendorCredits.allocate(
      context,
      owner,
      vendorCredit.id,
      { allocations: [{ billId: bill.id, amountMinor: '300' }] },
      metadata,
    );

    const billAfter = await harness.prisma.bill.findUniqueOrThrow({ where: { id: bill.id } });
    expect(billAfter.balanceMinor).toBe(100n);
    expect(billAfter.paidMinor).toBe(900n);

    // The bill's live remaining balance is now 100, while the vendor credit still has 1100
    // remaining -- requesting 101 must be rejected by the *per-bill* guard using the bill's live
    // balance, not silently allowed because the vendor credit itself has plenty left.
    await expect(
      vendorCredits.allocate(
        context,
        owner,
        vendorCredit.id,
        { allocations: [{ billId: bill.id, amountMinor: '101' }] },
        metadata,
      ),
    ).rejects.toThrow('exceeds its remaining balance');

    const billFinal = await harness.prisma.bill.findUniqueOrThrow({ where: { id: bill.id } });
    expect(billFinal.balanceMinor).toBe(100n);
  });

  it('derives ISSUED while partially applied, then APPLIED once fully consumed', async () => {
    const bill = await issuedBill('1000');
    const vendorCredit = await issuedVendorCredit('1000');

    const afterFirst = await vendorCredits.allocate(
      context,
      owner,
      vendorCredit.id,
      { allocations: [{ billId: bill.id, amountMinor: '600' }] },
      metadata,
    );
    expect(afterFirst.status).toBe('ISSUED');
    expect(afterFirst.remainingMinor).toBe('400');
    const billAfterFirst = await harness.prisma.bill.findUniqueOrThrow({ where: { id: bill.id } });
    expect(billAfterFirst.status).toBe('PARTIALLY_PAID');
    expect(billAfterFirst.balanceMinor).toBe(400n);

    const afterSecond = await vendorCredits.allocate(
      context,
      owner,
      vendorCredit.id,
      { allocations: [{ billId: bill.id, amountMinor: '400' }] },
      metadata,
    );
    expect(afterSecond.status).toBe('APPLIED');
    expect(afterSecond.remainingMinor).toBe('0');
    const billAfterSecond = await harness.prisma.bill.findUniqueOrThrow({ where: { id: bill.id } });
    expect(billAfterSecond.status).toBe('PAID');
    expect(billAfterSecond.balanceMinor).toBe(0n);

    const allocations = await harness.prisma.vendorCreditAllocation.findMany({
      where: { vendorCreditId: vendorCredit.id },
    });
    expect(allocations).toHaveLength(2);
    expect(new Set(allocations.map((allocation) => allocation.journalId)).size).toBe(2);
  });

  it('voids an issued vendor credit with an exact-reversal journal', async () => {
    const vendorCredit = await issuedVendorCredit('1000');

    const voided = await vendorCredits.voidVendorCredit(context, owner, vendorCredit.id, metadata);
    expect(voided.status).toBe('VOID');

    const originalJournal = await harness.prisma.journal.findFirstOrThrow({
      where: { id: vendorCredit.journalId! },
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

  it('rejects voiding a vendor credit that has already been partially applied', async () => {
    const bill = await issuedBill('1000');
    const vendorCredit = await issuedVendorCredit('1000');
    await vendorCredits.allocate(
      context,
      owner,
      vendorCredit.id,
      { allocations: [{ billId: bill.id, amountMinor: '400' }] },
      metadata,
    );

    await expect(
      vendorCredits.voidVendorCredit(context, owner, vendorCredit.id, metadata),
    ).rejects.toThrow('cannot be voided');
  });

  it('concurrent allocation race: exactly one of two competing calls succeeds without letting balances go negative', async () => {
    const billA = await issuedBill('1000');
    const billB = await issuedBill('1000');
    const vendorCredit = await issuedVendorCredit('1200');

    const results = await Promise.allSettled([
      vendorCredits.allocate(
        context,
        owner,
        vendorCredit.id,
        { allocations: [{ billId: billA.id, amountMinor: '1000' }] },
        metadata,
      ),
      vendorCredits.allocate(
        context,
        owner,
        vendorCredit.id,
        { allocations: [{ billId: billB.id, amountMinor: '1000' }] },
        metadata,
      ),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);

    const vendorCreditAfter = await harness.prisma.vendorCredit.findUniqueOrThrow({
      where: { id: vendorCredit.id },
    });
    expect(vendorCreditAfter.appliedMinor).toBe(1000n);
    expect(vendorCreditAfter.remainingMinor).toBe(200n);
  });

  it('atomically replays a same-idempotency-key allocate request', async () => {
    const bill = await issuedBill('1000');
    const vendorCredit = await issuedVendorCredit('1000');

    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        vendorCredits
          .allocate(
            context,
            owner,
            vendorCredit.id,
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
      await harness.prisma.vendorCreditAllocation.count({
        where: { vendorCreditId: vendorCredit.id, billId: bill.id },
      }),
    ).toBe(1);
    expect(
      await harness.prisma.ledgerIdempotencyKey.count({
        where: {
          organizationId: context.id,
          operation: 'VENDOR_CREDIT_ALLOCATE',
          key: 'same-allocate-key',
        },
      }),
    ).toBe(1);
  });
});
