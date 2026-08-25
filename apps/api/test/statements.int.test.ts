import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PublicUser } from '../src/auth/auth.service.js';
import { FiscalPeriodsService } from '../src/organizations/fiscal-periods.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import type { OrganizationContext } from '../src/organizations/organization-context.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { CreditNotesService } from '../src/sales/credit-notes.service.js';
import { CustomersService } from '../src/sales/customers.service.js';
import { InvoicesService } from '../src/sales/invoices.service.js';
import { PaymentsService } from '../src/sales/payments.service.js';
import { StatementsService } from '../src/sales/statements.service.js';
import { createTestHarness, type TestHarness } from './support/app.js';

const metadata = {
  ipHash: 'statements-test',
  userAgent: 'RetailBooks integration test',
};

describe('customer statement derivation against a real database', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let periods: FiscalPeriodsService;
  let customers: CustomersService;
  let invoices: InvoicesService;
  let payments: PaymentsService;
  let creditNotes: CreditNotesService;
  let statements: StatementsService;
  let owner: PublicUser;
  let context: OrganizationContext;
  let contactId: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
    periods = harness.app.get(FiscalPeriodsService);
    customers = harness.app.get(CustomersService);
    invoices = harness.app.get(InvoicesService);
    payments = harness.app.get(PaymentsService);
    creditNotes = harness.app.get(CreditNotesService);
    statements = harness.app.get(StatementsService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    const user = await harness.prisma.user.create({
      data: {
        email: 'statements-owner@example.test',
        displayName: 'Statements Owner',
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
      { legalName: 'Statement Books Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
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
      { contactId: customerId, lines: [{ description: 'Widget', quantity: '1', unitPriceMinor }] },
      metadata,
    );
    return invoices.issueInvoice(context, owner, draft.id, metadata);
  }

  function issuedInvoice(unitPriceMinor: string) {
    return issuedInvoiceFor(contactId, unitPriceMinor);
  }

  function today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  it('reconciles the closing balance to sum(Invoice.balanceMinor) for the contact', async () => {
    const invoiceA = await issuedInvoice('1000');
    const invoiceB = await issuedInvoice('2000');
    await issuedInvoice('3000');

    const payment = await payments.record(
      context,
      owner,
      { contactId, receivedDate: today(), amountMinor: '2500' },
      metadata,
    );
    await payments.allocate(
      context,
      owner,
      payment.id,
      {
        allocations: [
          { invoiceId: invoiceA.id, amountMinor: '1000' },
          { invoiceId: invoiceB.id, amountMinor: '1500' },
        ],
      },
      metadata,
    );

    const creditNoteDraft = await creditNotes.createDraft(
      context,
      owner,
      { contactId, lines: [{ description: 'Return', quantity: '1', unitPriceMinor: '800' }] },
      metadata,
    );
    const creditNote = await creditNotes.issueCreditNote(
      context,
      owner,
      creditNoteDraft.id,
      metadata,
    );
    await creditNotes.allocate(
      context,
      owner,
      creditNote.id,
      { allocations: [{ invoiceId: invoiceB.id, amountMinor: '500' }] },
      metadata,
    );

    const statement = await statements.getStatement(context.id, contactId, {});

    const dbInvoices = await harness.prisma.invoice.findMany({
      where: { organizationId: context.id, contactId },
    });
    const expectedClosing = dbInvoices.reduce((sum, invoice) => sum + invoice.balanceMinor, 0n);
    expect(statement.summary.closingBalanceMinor).toBe(expectedClosing.toString());
    expect(statement.summary.openingBalanceMinor).toBe('0');

    const types = statement.transactions.map((row) => row.type).sort();
    expect(types).toEqual(
      [
        'INVOICE_ISSUED',
        'INVOICE_ISSUED',
        'INVOICE_ISSUED',
        'PAYMENT_RECEIVED',
        'PAYMENT_ALLOCATED',
        'PAYMENT_ALLOCATED',
        'CREDIT_NOTE_ISSUED',
        'CREDIT_NOTE_ALLOCATED',
      ].sort(),
    );
  });

  it('carries both invoice and payment ids on an allocation row', async () => {
    const invoice = await issuedInvoice('1200');
    const payment = await payments.record(
      context,
      owner,
      { contactId, receivedDate: today(), amountMinor: '1200' },
      metadata,
    );
    await payments.allocate(
      context,
      owner,
      payment.id,
      { allocations: [{ invoiceId: invoice.id, amountMinor: '1200' }] },
      metadata,
    );

    const statement = await statements.getStatement(context.id, contactId, {});
    const allocationRow = statement.transactions.find((row) => row.type === 'PAYMENT_ALLOCATED');
    expect(allocationRow).toBeDefined();
    expect(allocationRow?.invoiceId).toBe(invoice.id);
    expect(allocationRow?.invoiceNumber).toBe(invoice.invoiceNumber);
    expect(allocationRow?.paymentId).toBe(payment.id);
    expect(allocationRow?.paymentNumber).toBe(payment.paymentNumber);
    expect(allocationRow?.creditMinor).toBe('1200');
    expect(allocationRow?.debitMinor).toBe('0');
  });

  it('shows an unapplied payment as an informational row that does not move the balance', async () => {
    const invoice = await issuedInvoice('1000');
    await payments.record(
      context,
      owner,
      { contactId, receivedDate: today(), amountMinor: '400' },
      metadata,
    );

    const statement = await statements.getStatement(context.id, contactId, {});
    const paymentIndex = statement.transactions.findIndex((row) => row.type === 'PAYMENT_RECEIVED');
    expect(paymentIndex).toBeGreaterThanOrEqual(0);
    const paymentRow = statement.transactions[paymentIndex]!;
    // Invoice issue and payment receipt both land on "today" (truncated to day), so they can sort
    // in either order -- assert the informational-row invariant against whichever row precedes it,
    // rather than assuming a fixed order between the two same-day events.
    const previousBalanceMinor =
      paymentIndex === 0
        ? statement.summary.openingBalanceMinor
        : statement.transactions[paymentIndex - 1]!.balanceMinor;
    expect(paymentRow.debitMinor).toBe('0');
    expect(paymentRow.creditMinor).toBe('0');
    expect(paymentRow.balanceMinor).toBe(previousBalanceMinor);
    expect(statement.summary.closingBalanceMinor).toBe(invoice.totalMinor);
  });

  it('excludes activity outside a bounded date range and computes the opening balance correctly', async () => {
    await issuedInvoice('750');

    const past = await statements.getStatement(context.id, contactId, { to: '2020-01-01' });
    expect(past.transactions).toEqual([]);
    expect(past.summary.openingBalanceMinor).toBe('0');
    expect(past.summary.closingBalanceMinor).toBe('0');

    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const unbounded = await statements.getStatement(context.id, contactId, {});
    const future = await statements.getStatement(context.id, contactId, { from: tomorrow });
    expect(future.transactions).toEqual([]);
    expect(future.summary.openingBalanceMinor).toBe(unbounded.summary.closingBalanceMinor);
    expect(future.summary.closingBalanceMinor).toBe(unbounded.summary.closingBalanceMinor);
  });

  it('throws for an unknown or cross-tenant contact', async () => {
    await expect(
      statements.getStatement(context.id, '00000000-0000-4000-8000-000000000099', {}),
    ).rejects.toThrow('Customer not found.');
  });

  it('returns zeroed balances and no transactions for a contact with no activity', async () => {
    const contact = await customers.create(context, owner, { displayName: 'Quiet Co' }, metadata);
    const statement = await statements.getStatement(context.id, contact.id, {});
    expect(statement.summary.openingBalanceMinor).toBe('0');
    expect(statement.summary.closingBalanceMinor).toBe('0');
    expect(statement.transactions).toEqual([]);
  });
});
