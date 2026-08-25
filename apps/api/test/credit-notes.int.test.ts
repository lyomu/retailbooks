import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PublicUser } from '../src/auth/auth.service.js';
import { FiscalPeriodsService } from '../src/organizations/fiscal-periods.service.js';
import { LedgerService } from '../src/organizations/ledger.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import type { OrganizationContext } from '../src/organizations/organization-context.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { CreditNotesService } from '../src/sales/credit-notes.service.js';
import { CustomersService } from '../src/sales/customers.service.js';
import { InvoicesService } from '../src/sales/invoices.service.js';
import { createTestHarness, type TestHarness } from './support/app.js';

const metadata = {
  ipHash: 'credit-notes-test',
  userAgent: 'RetailBooks integration test',
};

describe('credit note issuing, allocation, refund, and void against a real database', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let periods: FiscalPeriodsService;
  let ledger: LedgerService;
  let customers: CustomersService;
  let invoices: InvoicesService;
  let creditNotes: CreditNotesService;
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
    creditNotes = harness.app.get(CreditNotesService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    const user = await harness.prisma.user.create({
      data: {
        email: 'credit-notes-owner@example.test',
        displayName: 'Credit Notes Owner',
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
      { legalName: 'Credit Note Books Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
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

  async function issuedCreditNote(unitPriceMinor: string) {
    const draft = await creditNotes.createDraft(
      context,
      owner,
      { contactId, lines: [{ description: 'Return', quantity: '1', unitPriceMinor }] },
      metadata,
    );
    return creditNotes.issueCreditNote(context, owner, draft.id, metadata);
  }

  it('posts a balanced revenue/tax-debit, customer_credit-credit journal when issuing', async () => {
    const creditNote = await issuedCreditNote('1500');
    expect(creditNote.status).toBe('ISSUED');
    expect(creditNote.remainingMinor).toBe('1500');
    expect(creditNote.creditNoteNumber).toMatch(/^CRN-/);

    const journal = await harness.prisma.journal.findFirstOrThrow({
      where: { id: creditNote.journalId! },
      include: { lines: true },
    });
    const debitTotal = journal.lines.reduce((sum, line) => sum + line.debitMinor, 0n);
    const creditTotal = journal.lines.reduce((sum, line) => sum + line.creditMinor, 0n);
    expect(debitTotal).toBe(creditTotal);
    expect(debitTotal).toBe(1500n);

    const revenueAccount = await ledger.accountBySystemKey(context.id, 'sales_revenue');
    const customerCreditAccount = await ledger.accountBySystemKey(context.id, 'customer_credit');
    const revenueLine = journal.lines.find((line) => line.accountId === revenueAccount.id);
    expect(revenueLine?.debitMinor).toBe(1500n);
    const creditLine = journal.lines.find((line) => line.accountId === customerCreditAccount.id);
    expect(creditLine?.creditMinor).toBe(1500n);
  });

  it('rejects an allocation that exceeds a single invoice balance, atomically', async () => {
    const invoice = await issuedInvoice('1000');
    const creditNote = await issuedCreditNote('2000');

    await expect(
      creditNotes.allocate(
        context,
        owner,
        creditNote.id,
        { allocations: [{ invoiceId: invoice.id, amountMinor: '1500' }] },
        metadata,
      ),
    ).rejects.toThrow('exceeds its remaining balance');

    const invoiceAfter = await harness.prisma.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
    });
    expect(invoiceAfter.balanceMinor).toBe(1000n);
    const creditNoteAfter = await harness.prisma.creditNote.findUniqueOrThrow({
      where: { id: creditNote.id },
    });
    expect(creditNoteAfter.remainingMinor).toBe(2000n);
  });

  it('rejects an allocation whose total exceeds the remaining balance even though no single invoice is over its own balance', async () => {
    const invoiceA = await issuedInvoice('1000');
    const invoiceB = await issuedInvoice('1000');
    const creditNote = await issuedCreditNote('1500');

    await expect(
      creditNotes.allocate(
        context,
        owner,
        creditNote.id,
        {
          allocations: [
            { invoiceId: invoiceA.id, amountMinor: '1000' },
            { invoiceId: invoiceB.id, amountMinor: '800' },
          ],
        },
        metadata,
      ),
    ).rejects.toThrow("exceeds the credit note's remaining balance");

    const invoiceAAfter = await harness.prisma.invoice.findUniqueOrThrow({
      where: { id: invoiceA.id },
    });
    const invoiceBAfter = await harness.prisma.invoice.findUniqueOrThrow({
      where: { id: invoiceB.id },
    });
    expect(invoiceAAfter.balanceMinor).toBe(1000n);
    expect(invoiceBAfter.balanceMinor).toBe(1000n);
    expect(
      await harness.prisma.creditNoteAllocation.count({ where: { creditNoteId: creditNote.id } }),
    ).toBe(0);
  });

  it('derives ISSUED while partially applied, then APPLIED once fully consumed', async () => {
    const invoice = await issuedInvoice('1000');
    const creditNote = await issuedCreditNote('1000');

    const afterFirst = await creditNotes.allocate(
      context,
      owner,
      creditNote.id,
      { allocations: [{ invoiceId: invoice.id, amountMinor: '600' }] },
      metadata,
    );
    expect(afterFirst.status).toBe('ISSUED');
    expect(afterFirst.remainingMinor).toBe('400');
    const invoiceAfterFirst = await harness.prisma.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
    });
    expect(invoiceAfterFirst.status).toBe('PARTIALLY_PAID');
    expect(invoiceAfterFirst.balanceMinor).toBe(400n);

    const afterSecond = await creditNotes.allocate(
      context,
      owner,
      creditNote.id,
      { allocations: [{ invoiceId: invoice.id, amountMinor: '400' }] },
      metadata,
    );
    expect(afterSecond.status).toBe('APPLIED');
    expect(afterSecond.remainingMinor).toBe('0');
    const invoiceAfterSecond = await harness.prisma.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
    });
    expect(invoiceAfterSecond.status).toBe('PAID');
    expect(invoiceAfterSecond.balanceMinor).toBe(0n);

    const allocations = await harness.prisma.creditNoteAllocation.findMany({
      where: { creditNoteId: creditNote.id },
    });
    expect(allocations).toHaveLength(2);
    expect(new Set(allocations.map((allocation) => allocation.journalId)).size).toBe(2);
  });

  it('refunds the remaining balance in cash and derives REFUNDED once fully consumed', async () => {
    const creditNote = await issuedCreditNote('1000');

    const refunded = await creditNotes.refund(
      context,
      owner,
      creditNote.id,
      { amountMinor: '1000' },
      metadata,
    );
    expect(refunded.status).toBe('REFUNDED');
    expect(refunded.remainingMinor).toBe('0');
    expect(refunded.refundedMinor).toBe('1000');

    const refund = await harness.prisma.creditNoteRefund.findFirstOrThrow({
      where: { creditNoteId: creditNote.id },
    });
    const journal = await harness.prisma.journal.findFirstOrThrow({
      where: { id: refund.journalId },
      include: { lines: true },
    });
    const bankAccount = await ledger.accountBySystemKey(context.id, 'bank_default');
    const customerCreditAccount = await ledger.accountBySystemKey(context.id, 'customer_credit');
    const bankLine = journal.lines.find((line) => line.accountId === bankAccount.id);
    expect(bankLine?.creditMinor).toBe(1000n);
    const creditLine = journal.lines.find((line) => line.accountId === customerCreditAccount.id);
    expect(creditLine?.debitMinor).toBe(1000n);
  });

  it('rejects a refund that exceeds the remaining balance, atomically', async () => {
    const creditNote = await issuedCreditNote('1000');

    await expect(
      creditNotes.refund(context, owner, creditNote.id, { amountMinor: '1500' }, metadata),
    ).rejects.toThrow("exceeds the credit note's remaining balance");

    const creditNoteAfter = await harness.prisma.creditNote.findUniqueOrThrow({
      where: { id: creditNote.id },
    });
    expect(creditNoteAfter.remainingMinor).toBe(1000n);
    expect(
      await harness.prisma.creditNoteRefund.count({ where: { creditNoteId: creditNote.id } }),
    ).toBe(0);
  });

  it('voids an issued credit note with an exact-reversal journal', async () => {
    const creditNote = await issuedCreditNote('1000');

    const voided = await creditNotes.voidCreditNote(context, owner, creditNote.id, metadata);
    expect(voided.status).toBe('VOID');

    const originalJournal = await harness.prisma.journal.findFirstOrThrow({
      where: { id: creditNote.journalId! },
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

  it('rejects voiding a credit note that has already been partially applied', async () => {
    const invoice = await issuedInvoice('1000');
    const creditNote = await issuedCreditNote('1000');
    await creditNotes.allocate(
      context,
      owner,
      creditNote.id,
      { allocations: [{ invoiceId: invoice.id, amountMinor: '400' }] },
      metadata,
    );

    await expect(
      creditNotes.voidCreditNote(context, owner, creditNote.id, metadata),
    ).rejects.toThrow('cannot be voided');
  });

  it('concurrent allocation race: exactly one of two competing calls succeeds without letting balances go negative', async () => {
    const invoiceA = await issuedInvoice('1000');
    const invoiceB = await issuedInvoice('1000');
    const creditNote = await issuedCreditNote('1200');

    const results = await Promise.allSettled([
      creditNotes.allocate(
        context,
        owner,
        creditNote.id,
        { allocations: [{ invoiceId: invoiceA.id, amountMinor: '1000' }] },
        metadata,
      ),
      creditNotes.allocate(
        context,
        owner,
        creditNote.id,
        { allocations: [{ invoiceId: invoiceB.id, amountMinor: '1000' }] },
        metadata,
      ),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);

    const creditNoteAfter = await harness.prisma.creditNote.findUniqueOrThrow({
      where: { id: creditNote.id },
    });
    expect(creditNoteAfter.appliedMinor).toBe(1000n);
    expect(creditNoteAfter.remainingMinor).toBe(200n);
  });

  it('atomically replays a same-idempotency-key allocate request', async () => {
    const invoice = await issuedInvoice('1000');
    const creditNote = await issuedCreditNote('1000');

    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        creditNotes
          .allocate(
            context,
            owner,
            creditNote.id,
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
      await harness.prisma.creditNoteAllocation.count({
        where: { creditNoteId: creditNote.id, invoiceId: invoice.id },
      }),
    ).toBe(1);
    expect(
      await harness.prisma.ledgerIdempotencyKey.count({
        where: {
          organizationId: context.id,
          operation: 'CREDIT_NOTE_ALLOCATE',
          key: 'same-allocate-key',
        },
      }),
    ).toBe(1);
  });
});
