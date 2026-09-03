import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createOpaqueToken, hashToken } from '../src/auth/auth.crypto.js';
import type { PublicUser } from '../src/auth/auth.service.js';
import { FiscalPeriodsService } from '../src/organizations/fiscal-periods.service.js';
import { LedgerService } from '../src/organizations/ledger.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import type { OrganizationContext } from '../src/organizations/organization-context.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { TaxService } from '../src/organizations/tax.service.js';
import { CustomersService } from '../src/sales/customers.service.js';
import { InvoicesService } from '../src/sales/invoices.service.js';
import { API, createTestHarness, type TestHarness } from './support/app.js';

const metadata = {
  ipHash: 'invoices-test',
  userAgent: 'RetailBooks integration test',
};

describe('invoice posting against a real database', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let periods: FiscalPeriodsService;
  let ledger: LedgerService;
  let tax: TaxService;
  let customers: CustomersService;
  let invoices: InvoicesService;
  let owner: PublicUser;
  let context: OrganizationContext;
  let cookie: string;
  let contactId: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
    periods = harness.app.get(FiscalPeriodsService);
    ledger = harness.app.get(LedgerService);
    tax = harness.app.get(TaxService);
    customers = harness.app.get(CustomersService);
    invoices = harness.app.get(InvoicesService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    const user = await harness.prisma.user.create({
      data: {
        email: 'invoices-owner@example.test',
        displayName: 'Invoices Owner',
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
      { legalName: 'Invoice Books Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
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
    cookie = await sessionCookieFor(owner.id);
  });

  it('posts a balanced AR/revenue/tax journal for a multi-tax-code invoice', async () => {
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

    const draft = await invoices.createDraft(
      context,
      owner,
      {
        contactId,
        lines: [
          {
            description: 'Widget A',
            quantity: '2',
            unitPriceMinor: '10000',
            taxCodeId: codeA.id,
          },
          {
            description: 'Widget B',
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
    const issued = await invoices.issueInvoice(context, owner, draft.id, metadata);
    expect(issued.status).toBe('ISSUED');
    expect(issued.subtotalMinor).toBe('25000');
    expect(issued.taxTotalMinor).toBe('2250');
    expect(issued.totalMinor).toBe('27250');
    expect(issued.invoiceNumber).toMatch(/^INV-/);

    const journal = await harness.prisma.journal.findFirstOrThrow({
      where: { id: issued.journalId! },
      include: { lines: true },
    });
    const debitTotal = journal.lines.reduce((sum, line) => sum + line.debitMinor, 0n);
    const creditTotal = journal.lines.reduce((sum, line) => sum + line.creditMinor, 0n);
    expect(debitTotal).toBe(creditTotal);
    expect(debitTotal).toBe(27250n);

    const arAccount = await ledger.accountBySystemKey(context.id, 'accounts_receivable');
    const revenueAccount = await ledger.accountBySystemKey(context.id, 'sales_revenue');
    const taxAccount = await ledger.accountBySystemKey(context.id, 'tax_payable');

    const arLine = journal.lines.find((line) => line.accountId === arAccount.id);
    expect(arLine?.debitMinor).toBe(27250n);

    const revenueLine = journal.lines.find((line) => line.accountId === revenueAccount.id);
    expect(revenueLine?.creditMinor).toBe(25000n);

    const taxLines = journal.lines.filter((line) => line.accountId === taxAccount.id);
    expect(taxLines).toHaveLength(2);
    expect(taxLines.map((line) => line.creditMinor).sort()).toEqual([250n, 2000n].sort());
  });

  it('pins the country pack active at issue time and never restates it', async () => {
    const draft = await invoices.createDraft(
      context,
      owner,
      { contactId, lines: [{ description: 'Widget', quantity: '1', unitPriceMinor: '1000' }] },
      metadata,
    );
    const issued = await invoices.issueInvoice(context, owner, draft.id, metadata);

    const pinned = await harness.prisma.invoice.findUniqueOrThrow({ where: { id: issued.id } });
    expect(pinned.countryPackCodeSnapshot).toBe('KE');
    expect(pinned.countryPackVersionSnapshot).toBe('2026.1-draft');

    // A later pack edit must not restate what an issued document declared: the snapshot columns
    // are write-once at issue time, the same freeze the per-line tax snapshots use.
    await harness.prisma.organizationPreference.update({
      where: { organizationId: context.id },
      data: { countryPackVersion: '2027.1-draft' },
    });
    const afterPackEdit = await harness.prisma.invoice.findUniqueOrThrow({
      where: { id: issued.id },
    });
    expect(afterPackEdit.countryPackVersionSnapshot).toBe('2026.1-draft');
  });

  it('rejects issuing an already-issued invoice', async () => {
    const draft = await invoices.createDraft(
      context,
      owner,
      { contactId, lines: [{ description: 'Widget', quantity: '1', unitPriceMinor: '1000' }] },
      metadata,
    );
    await invoices.issueInvoice(context, owner, draft.id, metadata);

    await expect(invoices.issueInvoice(context, owner, draft.id, metadata)).rejects.toThrow(
      'Only draft invoices can be issued.',
    );
  });

  it('atomically replays a same-idempotency-key issue request', async () => {
    const draft = await invoices.createDraft(
      context,
      owner,
      { contactId, lines: [{ description: 'Widget', quantity: '1', unitPriceMinor: '1000' }] },
      metadata,
    );

    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        post(draft.id, 'same-issue-key').catch((error: unknown) => error),
      ),
    );
    const succeeded = responses.filter(
      (response): response is { body: { data: { id: string; invoiceNumber: string } } } =>
        typeof response === 'object' && response !== null && 'body' in response,
    );
    expect(succeeded).toHaveLength(6);
    const invoiceIds = new Set(succeeded.map((response) => response.body.data.id));
    const references = new Set(succeeded.map((response) => response.body.data.invoiceNumber));
    expect(invoiceIds.size).toBe(1);
    expect(references.size).toBe(1);

    expect(
      await harness.prisma.ledgerIdempotencyKey.count({
        where: {
          organizationId: context.id,
          operation: 'INVOICE_ISSUE_INVOICE',
          key: 'same-issue-key',
        },
      }),
    ).toBe(1);
  });

  it('allows only one competing issue with different idempotency keys and does not burn a number', async () => {
    const draft = await invoices.createDraft(
      context,
      owner,
      { contactId, lines: [{ description: 'Widget', quantity: '1', unitPriceMinor: '1000' }] },
      metadata,
    );

    const results = await Promise.allSettled([
      post(draft.id, 'competitor-a'),
      post(draft.id, 'competitor-b'),
    ]);
    const statuses = results.map((result) =>
      result.status === 'fulfilled'
        ? result.value.status
        : (result.reason as { status: number }).status,
    );
    expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    expect(statuses.filter((status) => status !== 200)).toHaveLength(1);

    const sequence = await harness.prisma.documentNumberSequence.findFirstOrThrow({
      where: { organizationId: context.id, documentType: 'INVOICE' },
    });
    expect(sequence.lastAllocatedNumber).toBe(1);
    expect(sequence.nextNumber).toBe(2);
  });

  it('voids an issued invoice with an exact-reversal journal', async () => {
    const draft = await invoices.createDraft(
      context,
      owner,
      { contactId, lines: [{ description: 'Widget', quantity: '1', unitPriceMinor: '1000' }] },
      metadata,
    );
    const issued = await invoices.issueInvoice(context, owner, draft.id, metadata);

    const voided = await invoices.voidInvoice(context, owner, issued.id, metadata);
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

  it('rejects voiding a draft invoice', async () => {
    const draft = await invoices.createDraft(
      context,
      owner,
      { contactId, lines: [{ description: 'Widget', quantity: '1', unitPriceMinor: '1000' }] },
      metadata,
    );
    await expect(invoices.voidInvoice(context, owner, draft.id, metadata)).rejects.toThrow(
      'Only issued invoices can be voided.',
    );
  });

  function post(invoiceId: string, idempotencyKey: string) {
    return harness
      .http()
      .post(`${API}/organizations/${context.id}/invoices/${invoiceId}/issue`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', idempotencyKey)
      .then((response) => {
        if (response.status !== 200) throw Object.assign(new Error('non-200'), response);
        return response;
      });
  }

  async function sessionCookieFor(userId: string): Promise<string> {
    const rawToken = createOpaqueToken();
    await harness.prisma.session.create({
      data: {
        userId,
        tokenHash: hashToken(rawToken),
        userAgent: metadata.userAgent,
        ipHash: metadata.ipHash,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    return `rb_session=${rawToken}`;
  }
});
