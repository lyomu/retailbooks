import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createOpaqueToken, hashToken } from '../src/auth/auth.crypto.js';
import type { PublicUser } from '../src/auth/auth.service.js';
import { FiscalPeriodsService } from '../src/organizations/fiscal-periods.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import type { OrganizationContext } from '../src/organizations/organization-context.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { TaxService } from '../src/organizations/tax.service.js';
import { CustomersService } from '../src/sales/customers.service.js';
import { InvoicesService } from '../src/sales/invoices.service.js';
import { API, createTestHarness, type TestHarness } from './support/app.js';

const metadata = {
  ipHash: 'structured-invoice-test',
  userAgent: 'RetailBooks integration test',
};

type DataOf<T> = { data: T };
type ComplianceView = {
  status: string;
  packCode: string;
  packVersion: string;
  tier: string | null;
};

describe('structured invoice: canonical data artifact', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let periods: FiscalPeriodsService;
  let tax: TaxService;
  let customers: CustomersService;
  let invoices: InvoicesService;
  let owner: PublicUser;
  let context: OrganizationContext;
  let contactId: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
    periods = harness.app.get(FiscalPeriodsService);
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
        email: 'structured-invoice-owner@example.test',
        displayName: 'Structured Invoice Owner',
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
      { legalName: 'Structured Books Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
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

  it('persists a structured invoice as a canonical data artifact at issue time', async () => {
    const code = await tax.createTaxCode(
      context,
      owner,
      { code: 'VAT', name: 'VAT 16%', treatment: 'EXCLUSIVE', recoverable: true },
      metadata,
    );
    await tax.createRate(
      context,
      owner,
      code.id,
      { ratePercent: '16.00', effectiveFrom: '2026-01-01' },
      metadata,
    );
    await tax.createTaxCode(
      context,
      owner,
      { code: 'ZERO', name: 'Zero-rated', treatment: 'EXCLUSIVE', recoverable: true },
      metadata,
    );

    const draft = await invoices.createDraft(
      context,
      owner,
      {
        contactId,
        lines: [
          { description: 'Widget', quantity: '1', unitPriceMinor: '100000', taxCodeId: code.id },
          { description: 'Support', quantity: '1', unitPriceMinor: '25000' },
        ],
      },
      metadata,
    );
    const issued = await invoices.issueInvoice(context, owner, draft.id, metadata);

    const structured = await harness.prisma.structuredInvoice.findUnique({
      where: {
        organizationId_documentType_documentId: {
          organizationId: context.id,
          documentType: 'INVOICE',
          documentId: issued.id,
        },
      },
    });
    expect(structured).not.toBeNull();
    expect(structured?.payload).toMatchObject({
      invoiceNumber: issued.invoiceNumber,
      currency: 'KES',
    });

    // The payload is the canonical data artifact: it carries the frozen pack version, totals, and
    // per-line tax snapshots -- the same data a regulator or a customer AP system consumes.
    expect(structured?.countryPackCode).toBe('KE');
    expect(structured?.countryPackVersion).toBe('2026.1-draft');
    expect(structured?.payloadSchemaVersion).toBe('1');

    const payload = structured?.payload as Record<string, unknown>;
    const totals = payload.totals as Record<string, string>;
    expect(totals.subtotalMinor).toBe('125000');
    expect(totals.taxTotalMinor).toBe('16000');
    expect(totals.totalMinor).toBe('141000');

    const lines = payload.lines as Array<Record<string, unknown>>;
    expect(lines).toHaveLength(2);
    expect(lines[0]!.description).toBe('Widget');
    expect(lines[0]!.lineTotalMinor).toBe('100000');
    expect((lines[0]!.tax as Record<string, string>).taxAmountMinor).toBe('16000');
    expect(lines[1]!.description).toBe('Support');
    expect(lines[1]!.lineTotalMinor).toBe('25000');
    expect((lines[1]!.tax as Record<string, string>).taxAmountMinor).toBe('0');

    const customer = payload.customer as Record<string, string>;
    expect(customer.name).toBe('Acme Retail');
  });

  it('keeps the structured invoice independent of PDF rendering -- no render step is required', async () => {
    const draft = await invoices.createDraft(
      context,
      owner,
      { contactId, lines: [{ description: 'Widget', quantity: '1', unitPriceMinor: '1000' }] },
      metadata,
    );
    const issued = await invoices.issueInvoice(context, owner, draft.id, metadata);

    // A PDF render artifact (DocumentSnapshot) is optional and created only on send; the structured
    // invoice exists the moment the document is issued, without any render step.
    const pdfSnapshot = await harness.prisma.documentSnapshot.findFirst({
      where: { documentId: issued.id },
    });
    expect(pdfSnapshot).toBeNull();

    const structured = await harness.prisma.structuredInvoice.findUnique({
      where: {
        organizationId_documentType_documentId: {
          organizationId: context.id,
          documentType: 'INVOICE',
          documentId: issued.id,
        },
      },
    });
    expect(structured).not.toBeNull();
    expect(structured?.payload).toMatchObject({
      invoiceNumber: issued.invoiceNumber,
      currency: 'KES',
    });
  });

  it('round-trips the structured invoice unchanged when the pack is later edited', async () => {
    const draft = await invoices.createDraft(
      context,
      owner,
      { contactId, lines: [{ description: 'Widget', quantity: '1', unitPriceMinor: '1000' }] },
      metadata,
    );
    const issued = await invoices.issueInvoice(context, owner, draft.id, metadata);

    // A later pack edit must not restate the canonical artifact any more than it restates the
    // invoice own snapshot columns.
    await harness.prisma.organizationPreference.update({
      where: { organizationId: context.id },
      data: { countryPackVersion: '2027.1-draft' },
    });

    const structured = await harness.prisma.structuredInvoice.findUnique({
      where: {
        organizationId_documentType_documentId: {
          organizationId: context.id,
          documentType: 'INVOICE',
          documentId: issued.id,
        },
      },
    });
    expect(structured?.countryPackVersion).toBe('2026.1-draft');
    const payload = structured?.payload as Record<string, unknown>;
    expect((payload.countryPack as Record<string, string>).version).toBe('2026.1-draft');
  });
});

describe('Phase 8D: unsupported-jurisdiction compliance claims never render', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let owner: PublicUser;
  let context: OrganizationContext;
  let cookie: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    const user = await harness.prisma.user.create({
      data: {
        email: 'unsupported-jurisdiction-owner@example.test',
        displayName: 'Unsupported Jurisdiction Owner',
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
    cookie = await sessionCookieFor(owner.id);
  });

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

  it('never renders a compliance claim for an unsupported jurisdiction', async () => {
    // An organization whose pinned pack resolves to UNSUPPORTED (unknown code, no catalog match).
    // Organization creation validates countryCode against the catalog, so create with a valid code
    // and then repoint the preference to an unknown pack -- the compliance resolver reads the
    // preference, not the country code, so this produces the UNSUPPORTED posture deterministically.
    const created = await organizations.create(
      owner,
      { legalName: 'Frontier Books Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    const draftContext = await access.requireMembership(owner.id, created.id);
    await organizations.finalize(draftContext, owner, metadata);
    context = await access.requireMembership(owner.id, created.id);

    // Pin an unknown country code so resolveCompliance returns UNSUPPORTED.
    await harness.prisma.organizationPreference.update({
      where: { organizationId: context.id },
      data: { countryPackCode: 'ZZ', countryPackVersion: '1' },
    });

    const detail = await harness
      .http()
      .get(`${API}/organizations/${context.id}`)
      .set('Cookie', cookie)
      .expect(200);

    const compliance = (detail.body as DataOf<{ compliance: ComplianceView }>).data.compliance;
    expect(compliance.status).toBe('UNSUPPORTED');
    expect(compliance.packCode).toBe('ZZ');
    expect(compliance.tier).toBeNull();

    // The badge must never claim compliance where unreviewed: not "fully reviewed", not even
    // "generic configuration". Only UNSUPPORTED is honest for a jurisdiction with no pack.
    expect(compliance.status).not.toBe('FULLY_REVIEWED');
    expect(compliance.status).not.toBe('GENERIC_CONFIGURATION');

    // And the API agrees with the badge: compliance-sensitive tax setup is blocked.
    await harness
      .http()
      .patch(`${API}/organizations/${context.id}`)
      .set('Cookie', cookie)
      .send({ section: 'TAX', taxRegistered: true })
      .expect(400);
  });
});
