import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PublicUser } from '../src/auth/auth.service.js';
import { FiscalPeriodsService } from '../src/organizations/fiscal-periods.service.js';
import { LedgerService } from '../src/organizations/ledger.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import type { OrganizationContext } from '../src/organizations/organization-context.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { CustomersService } from '../src/sales/customers.service.js';
import { InvoicesService } from '../src/sales/invoices.service.js';
import { PaymentsService } from '../src/sales/payments.service.js';
import { createTestHarness, type TestHarness } from './support/app.js';

const metadata = {
  ipHash: 'payments-test',
  userAgent: 'RetailBooks integration test',
};

describe('payment recording and allocation against a real database', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let periods: FiscalPeriodsService;
  let ledger: LedgerService;
  let customers: CustomersService;
  let invoices: InvoicesService;
  let payments: PaymentsService;
  let owner: PublicUser;
  let context: OrganizationContext;
  let contactId: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
    periods = harness.app.get(FiscalPeriodsService);
    ledger = harness.app.get(LedgerService);
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
        email: 'payments-owner@example.test',
        displayName: 'Payments Owner',
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
      { legalName: 'Payment Books Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    const draftContext = await access.requireMembership(owner.id, created.id);
    await organizations.finalize(draftContext, owner, metadata);
    context = await access.requireMembership(owner.id, created.id);
    await periods.generateFiscalYear(context, owner, { startsOn: '2026-01-01' }, metadata);

    const contact = await customers.create(
      context,
      owner,
      { displayName: 'Acme Retail' },
      metadata,
    );
    contactId = contact.id;
  });

  async function issuedInvoiceFor(customerId: string, unitPriceMinor: string) {
    const draft = await invoices.createDraft(
      context,
      owner,
      {
        contactId: customerId,
        lines: [{ description: 'Widget', quantity: '1', unitPriceMinor }],
      },
      metadata,
    );
    return invoices.issueInvoice(context, owner, draft.id, metadata);
  }

  function issuedInvoice(unitPriceMinor: string) {
    return issuedInvoiceFor(contactId, unitPriceMinor);
  }

  it('records a balanced deposit/AR journal when recording a payment', async () => {
    const payment = await payments.record(
      context,
      owner,
      { contactId, receivedDate: '2026-02-01', amountMinor: '1500' },
      metadata,
    );
    expect(payment.status).toBe('UNAPPLIED');
    expect(payment.unappliedMinor).toBe('1500');
    expect(payment.allocatedMinor).toBe('0');
    expect(payment.paymentNumber).toMatch(/^PMT-/);

    const journal = await harness.prisma.journal.findFirstOrThrow({
      where: { id: payment.journalId! },
      include: { lines: true },
    });
    const debitTotal = journal.lines.reduce((sum, line) => sum + line.debitMinor, 0n);
    const creditTotal = journal.lines.reduce((sum, line) => sum + line.creditMinor, 0n);
    expect(debitTotal).toBe(creditTotal);
    expect(debitTotal).toBe(1500n);

    const depositAccount = await ledger.accountBySystemKey(context.id, 'bank_default');
    const arAccount = await ledger.accountBySystemKey(context.id, 'accounts_receivable');
    const depositLine = journal.lines.find((line) => line.accountId === depositAccount.id);
    expect(depositLine?.debitMinor).toBe(1500n);
    const arLine = journal.lines.find((line) => line.accountId === arAccount.id);
    expect(arLine?.creditMinor).toBe(1500n);
  });

  it('rejects an allocation that exceeds a single invoice balance, atomically', async () => {
    const invoice = await issuedInvoice('1000');
    const payment = await payments.record(
      context,
      owner,
      { contactId, receivedDate: '2026-02-01', amountMinor: '2000' },
      metadata,
    );

    await expect(
      payments.allocate(
        context,
        owner,
        payment.id,
        { allocations: [{ invoiceId: invoice.id, amountMinor: '1500' }] },
        metadata,
      ),
    ).rejects.toThrow('exceeds its remaining balance');

    const invoiceAfter = await harness.prisma.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
    });
    expect(invoiceAfter.balanceMinor).toBe(1000n);
    const paymentAfter = await harness.prisma.paymentReceived.findUniqueOrThrow({
      where: { id: payment.id },
    });
    expect(paymentAfter.unappliedMinor).toBe(2000n);
  });

  it('rejects an allocation whose total exceeds unappliedMinor even though no single invoice is over its own balance', async () => {
    const invoiceA = await issuedInvoice('1000');
    const invoiceB = await issuedInvoice('1000');
    const payment = await payments.record(
      context,
      owner,
      { contactId, receivedDate: '2026-02-01', amountMinor: '1500' },
      metadata,
    );

    await expect(
      payments.allocate(
        context,
        owner,
        payment.id,
        {
          allocations: [
            { invoiceId: invoiceA.id, amountMinor: '1000' },
            { invoiceId: invoiceB.id, amountMinor: '800' },
          ],
        },
        metadata,
      ),
    ).rejects.toThrow("exceeds the payment's unapplied amount");

    const invoiceAAfter = await harness.prisma.invoice.findUniqueOrThrow({
      where: { id: invoiceA.id },
    });
    const invoiceBAfter = await harness.prisma.invoice.findUniqueOrThrow({
      where: { id: invoiceB.id },
    });
    expect(invoiceAAfter.balanceMinor).toBe(1000n);
    expect(invoiceBAfter.balanceMinor).toBe(1000n);
    expect(await harness.prisma.paymentAllocation.count({ where: { paymentId: payment.id } })).toBe(
      0,
    );
  });

  it('derives PARTIALLY_PAID/PARTIALLY_ALLOCATED then PAID/FULLY_ALLOCATED across two allocation calls', async () => {
    const invoice = await issuedInvoice('1000');
    const payment = await payments.record(
      context,
      owner,
      { contactId, receivedDate: '2026-02-01', amountMinor: '1000' },
      metadata,
    );

    const afterFirst = await payments.allocate(
      context,
      owner,
      payment.id,
      { allocations: [{ invoiceId: invoice.id, amountMinor: '600' }] },
      metadata,
    );
    expect(afterFirst.status).toBe('PARTIALLY_ALLOCATED');
    const invoiceAfterFirst = await harness.prisma.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
    });
    expect(invoiceAfterFirst.status).toBe('PARTIALLY_PAID');
    expect(invoiceAfterFirst.balanceMinor).toBe(400n);

    const afterSecond = await payments.allocate(
      context,
      owner,
      payment.id,
      { allocations: [{ invoiceId: invoice.id, amountMinor: '400' }] },
      metadata,
    );
    expect(afterSecond.status).toBe('FULLY_ALLOCATED');
    expect(afterSecond.unappliedMinor).toBe('0');
    const invoiceAfterSecond = await harness.prisma.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
    });
    expect(invoiceAfterSecond.status).toBe('PAID');
    expect(invoiceAfterSecond.balanceMinor).toBe(0n);
  });

  it('concurrent allocation race: exactly one of two competing calls succeeds without letting balances go negative', async () => {
    const invoiceA = await issuedInvoice('1000');
    const invoiceB = await issuedInvoice('1000');
    const payment = await payments.record(
      context,
      owner,
      { contactId, receivedDate: '2026-02-01', amountMinor: '1200' },
      metadata,
    );

    const results = await Promise.allSettled([
      payments.allocate(
        context,
        owner,
        payment.id,
        { allocations: [{ invoiceId: invoiceA.id, amountMinor: '1000' }] },
        metadata,
      ),
      payments.allocate(
        context,
        owner,
        payment.id,
        { allocations: [{ invoiceId: invoiceB.id, amountMinor: '1000' }] },
        metadata,
      ),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);

    // Only one 1000 allocation can fit inside a 1200 unapplied balance -- the outcome is
    // deterministic regardless of which of the two competing calls wins the payment-row lock.
    const paymentAfter = await harness.prisma.paymentReceived.findUniqueOrThrow({
      where: { id: payment.id },
    });
    expect(paymentAfter.allocatedMinor).toBe(1000n);
    expect(paymentAfter.unappliedMinor).toBe(200n);

    const invoiceAAfter = await harness.prisma.invoice.findUniqueOrThrow({
      where: { id: invoiceA.id },
    });
    const invoiceBAfter = await harness.prisma.invoice.findUniqueOrThrow({
      where: { id: invoiceB.id },
    });
    expect(invoiceAAfter.balanceMinor >= 0n).toBe(true);
    expect(invoiceBAfter.balanceMinor >= 0n).toBe(true);
    expect(invoiceAAfter.balanceMinor + invoiceBAfter.balanceMinor).toBe(1000n);
  });

  it('atomically replays a same-idempotency-key allocate request', async () => {
    const invoice = await issuedInvoice('1000');
    const payment = await payments.record(
      context,
      owner,
      { contactId, receivedDate: '2026-02-01', amountMinor: '1000' },
      metadata,
    );

    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        payments
          .allocate(
            context,
            owner,
            payment.id,
            { allocations: [{ invoiceId: invoice.id, amountMinor: '1000' }] },
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
      await harness.prisma.paymentAllocation.count({
        where: { paymentId: payment.id, invoiceId: invoice.id },
      }),
    ).toBe(1);
    expect(
      await harness.prisma.ledgerIdempotencyKey.count({
        where: {
          organizationId: context.id,
          operation: 'PAYMENT_ALLOCATE',
          key: 'same-allocate-key',
        },
      }),
    ).toBe(1);
  });

  it('rejects allocating an invoice that belongs to a different customer than the payment', async () => {
    const otherContact = await customers.create(
      context,
      owner,
      { displayName: 'Other Co' },
      metadata,
    );
    const otherInvoice = await issuedInvoiceFor(otherContact.id, '1000');

    const payment = await payments.record(
      context,
      owner,
      { contactId, receivedDate: '2026-02-01', amountMinor: '1000' },
      metadata,
    );

    await expect(
      payments.allocate(
        context,
        owner,
        payment.id,
        { allocations: [{ invoiceId: otherInvoice.id, amountMinor: '500' }] },
        metadata,
      ),
    ).rejects.toThrow("does not belong to this payment's customer");
  });

  it('rejects allocating a draft invoice', async () => {
    const draft = await invoices.createDraft(
      context,
      owner,
      { contactId, lines: [{ description: 'Widget', quantity: '1', unitPriceMinor: '1000' }] },
      metadata,
    );
    const payment = await payments.record(
      context,
      owner,
      { contactId, receivedDate: '2026-02-01', amountMinor: '1000' },
      metadata,
    );

    await expect(
      payments.allocate(
        context,
        owner,
        payment.id,
        { allocations: [{ invoiceId: draft.id, amountMinor: '500' }] },
        metadata,
      ),
    ).rejects.toThrow('is not open for allocation');
  });

  it('rejects allocating a voided invoice', async () => {
    const issued = await issuedInvoice('1000');
    const voided = await invoices.voidInvoice(context, owner, issued.id, metadata);

    const payment = await payments.record(
      context,
      owner,
      { contactId, receivedDate: '2026-02-01', amountMinor: '1000' },
      metadata,
    );

    await expect(
      payments.allocate(
        context,
        owner,
        payment.id,
        { allocations: [{ invoiceId: voided.id, amountMinor: '500' }] },
        metadata,
      ),
    ).rejects.toThrow('is not open for allocation');
  });
});
