import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AuthMailerService } from '../src/auth/auth-mailer.service.js';
import { createOpaqueToken, hashToken } from '../src/auth/auth.crypto.js';
import type { PublicUser } from '../src/auth/auth.service.js';
import { FiscalPeriodsService } from '../src/organizations/fiscal-periods.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import type { OrganizationContext } from '../src/organizations/organization-context.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { PortalsService } from '../src/portals/portals.service.js';
import { CustomersService } from '../src/sales/customers.service.js';
import { InvoicesService } from '../src/sales/invoices.service.js';
import { PaymentsService } from '../src/sales/payments.service.js';
import { QuotesService } from '../src/sales/quotes.service.js';
import { SalesOrdersService } from '../src/sales/sales-orders.service.js';
import { API, createTestHarness, type TestHarness } from './support/app.js';

const metadata = { ipHash: 'portals-test', userAgent: 'RetailBooks integration test' };

/**
 * Phase 11 portal acceptance. Every assertion here is about a boundary rather than a feature: what
 * an invitation binds to, what a grant can reach, and what a customer must never see. The portal is
 * the only surface in RetailBooks where an unprivileged outside party reads tenant data, so the
 * failure mode being tested for throughout is disclosure, not error handling.
 */
describe('customer portal against a real database', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let periods: FiscalPeriodsService;
  let customers: CustomersService;
  let quotes: QuotesService;
  let salesOrders: SalesOrdersService;
  let invoices: InvoicesService;
  let payments: PaymentsService;
  let portals: PortalsService;

  let owner: PublicUser;
  let context: OrganizationContext;
  let acmeId: string;
  let betaId: string;
  let customer: PublicUser;
  let customerCookie: string;
  /** Tokens the mailer was asked to send, newest last, keyed by recipient. */
  let sentTokens: Array<{ email: string; token: string }>;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
    periods = harness.app.get(FiscalPeriodsService);
    customers = harness.app.get(CustomersService);
    quotes = harness.app.get(QuotesService);
    salesOrders = harness.app.get(SalesOrdersService);
    invoices = harness.app.get(InvoicesService);
    payments = harness.app.get(PaymentsService);
    portals = harness.app.get(PortalsService);

    // The invitation token only ever exists in memory and in the email; the row stores its hash.
    // Capturing it at the mailer is the only way a test can accept an invitation the way a real
    // recipient would, rather than reaching behind the service to forge one.
    const mailer = harness.app.get(AuthMailerService);
    const original = mailer.sendPortalInvitation.bind(mailer);
    mailer.sendPortalInvitation = async (invitation) => {
      sentTokens.push({ email: invitation.email, token: invitation.token });
      await original(invitation);
    };
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    sentTokens = [];
    owner = await createUser('portal-owner@example.test', 'Portal Owner');
    context = await createActiveOrganization(owner, 'Portal Books Ltd');
    await periods.generateFiscalYear(context, owner, { startsOn: '2026-01-01' }, metadata);
    acmeId = (
      await customers.create(
        context,
        owner,
        { displayName: 'Acme Retail', email: 'acme@example.test' },
        metadata,
      )
    ).id;
    betaId = (
      await customers.create(
        context,
        owner,
        { displayName: 'Beta Trading', email: 'beta@example.test' },
        metadata,
      )
    ).id;
    customer = await createUser('buyer@example.test', 'Acme Buyer');
    customerCookie = await sessionCookieFor(customer.id);
  });

  describe('invitations', () => {
    it('binds an invitation to the invited address: another verified user cannot redeem it', async () => {
      const token = await inviteToken(acmeId, customer.email);
      const intruder = await createUser('intruder@example.test', 'Intruder');

      await harness
        .http()
        .post(`${API}/portal-invitations/accept`)
        .set('Cookie', await sessionCookieFor(intruder.id))
        .send({ token })
        .expect(404);

      expect(await harness.prisma.portalUser.count()).toBe(0);
    });

    it('refuses acceptance until the redeeming user has verified their own email', async () => {
      const unverified = await harness.prisma.user.create({
        data: {
          email: 'unverified@example.test',
          displayName: 'Unverified Buyer',
          status: 'ACTIVE',
        },
      });
      const token = await inviteToken(acmeId, unverified.email);

      await harness
        .http()
        .post(`${API}/portal-invitations/accept`)
        .set('Cookie', await sessionCookieFor(unverified.id))
        .send({ token })
        .expect(409);
    });

    it('treats an expired invitation as if it never existed, on preview and on acceptance', async () => {
      const token = await inviteToken(acmeId, customer.email);
      await harness.prisma.portalInvitation.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await harness.http().post(`${API}/portal-invitations/preview`).send({ token }).expect(404);
      await harness
        .http()
        .post(`${API}/portal-invitations/accept`)
        .set('Cookie', customerCookie)
        .send({ token })
        .expect(404);
    });

    it('consumes an invitation exactly once, so a replayed token cannot mint a second grant', async () => {
      const token = await inviteToken(acmeId, customer.email);

      await harness
        .http()
        .post(`${API}/portal-invitations/accept`)
        .set('Cookie', customerCookie)
        .send({ token })
        .expect(200);
      await harness
        .http()
        .post(`${API}/portal-invitations/accept`)
        .set('Cookie', customerCookie)
        .send({ token })
        .expect(404);

      expect(await harness.prisma.portalUser.count()).toBe(1);
    });

    it('revokes a pending invitation and any grant it already produced', async () => {
      const token = await inviteToken(acmeId, customer.email);
      const invitation = await harness.prisma.portalInvitation.findFirstOrThrow();

      await portals.revokeInvitation(context.id, invitation.id);
      await harness
        .http()
        .post(`${API}/portal-invitations/accept`)
        .set('Cookie', customerCookie)
        .send({ token })
        .expect(404);

      const second = await inviteToken(acmeId, customer.email);
      const grant = await acceptInvitation(second, customerCookie);
      await portals.revokeUser(context.id, grant);

      const accounts = await listAccounts(customerCookie);
      expect(accounts).toHaveLength(0);
      await harness
        .http()
        .get(`${API}/portal/accounts/${grant}/overview`)
        .set('Cookie', customerCookie)
        .expect(404);
    });

    it('supersedes an earlier pending invitation to the same address rather than leaving two live', async () => {
      const first = await inviteToken(acmeId, customer.email);
      const second = await inviteToken(acmeId, customer.email);

      await harness
        .http()
        .post(`${API}/portal-invitations/accept`)
        .set('Cookie', customerCookie)
        .send({ token: first })
        .expect(404);
      await harness
        .http()
        .post(`${API}/portal-invitations/accept`)
        .set('Cookie', customerCookie)
        .send({ token: second })
        .expect(200);
    });

    it('lets one customer hold several portal users, each an independent grant', async () => {
      const colleague = await createUser('colleague@example.test', 'Acme Colleague');
      const colleagueCookie = await sessionCookieFor(colleague.id);
      await acceptInvitation(await inviteToken(acmeId, customer.email), customerCookie);
      await acceptInvitation(await inviteToken(acmeId, colleague.email), colleagueCookie);

      expect(await listAccounts(customerCookie)).toHaveLength(1);
      expect(await listAccounts(colleagueCookie)).toHaveLength(1);
      expect(await harness.prisma.portalUser.count({ where: { contactId: acmeId } })).toBe(2);
    });

    it('keeps one identity holding several grants strictly separated per customer and tenant', async () => {
      const otherOwner = await createUser('other-owner@example.test', 'Other Owner');
      const otherContext = await createActiveOrganization(otherOwner, 'Rival Books Ltd');
      const rivalId = (
        await customers.create(otherContext, otherOwner, { displayName: 'Rival Buyer' }, metadata)
      ).id;

      const acmeGrant = await acceptInvitation(
        await inviteToken(acmeId, customer.email),
        customerCookie,
      );
      const betaGrant = await acceptInvitation(
        await inviteToken(betaId, customer.email),
        customerCookie,
      );
      const rivalGrant = await acceptInvitation(
        await inviteToken(rivalId, customer.email, otherContext, otherOwner),
        customerCookie,
      );

      const accounts = await listAccounts(customerCookie);
      expect(accounts).toHaveLength(3);
      expect(new Set([acmeGrant, betaGrant, rivalGrant]).size).toBe(3);

      const acmeInvoice = await issuedInvoice(acmeId, '4000');
      const betaInvoice = await issuedInvoice(betaId, '9000');

      const acmeDocuments = await documents(acmeGrant);
      expect(acmeDocuments.map((document) => document.id)).toEqual([acmeInvoice]);
      const betaDocuments = await documents(betaGrant);
      expect(betaDocuments.map((document) => document.id)).toEqual([betaInvoice]);
      expect(await documents(rivalGrant)).toHaveLength(0);

      // A document id from a sibling grant is not reachable through the wrong grant, even though
      // the same signed-in identity holds both.
      await harness
        .http()
        .get(`${API}/portal/accounts/${acmeGrant}/documents/INVOICE/${betaInvoice}`)
        .set('Cookie', customerCookie)
        .expect(404);
    });
  });

  describe('document exposure', () => {
    let grant: string;

    beforeEach(async () => {
      grant = await acceptInvitation(await inviteToken(acmeId, customer.email), customerCookie);
    });

    it('hides draft documents and reveals them only once their lifecycle exposes them', async () => {
      const draft = await invoices.createDraft(
        context,
        owner,
        {
          contactId: acmeId,
          lines: [{ description: 'Widget', quantity: '1', unitPriceMinor: '100' }],
        },
        metadata,
      );
      expect(await documents(grant)).toHaveLength(0);
      await harness
        .http()
        .get(`${API}/portal/accounts/${grant}/documents/INVOICE/${draft.id}`)
        .set('Cookie', customerCookie)
        .expect(404);

      await invoices.issueInvoice(context, owner, draft.id, metadata);
      expect((await documents(grant)).map((document) => document.id)).toEqual([draft.id]);
    });

    it('shows a quote only after it is sent', async () => {
      const quote = await draftQuote(acmeId);
      expect(await documents(grant)).toHaveLength(0);

      await quotes.submitForApproval(context, owner, quote, metadata);
      await quotes.approve(context, owner, quote, metadata);
      expect(await documents(grant)).toHaveLength(0);

      await quotes.send(context, owner, quote, metadata);
      expect((await documents(grant)).map((document) => document.id)).toEqual([quote]);
    });

    it('keeps a confirmed sales order visible as history after it is cancelled', async () => {
      const order = await salesOrders.createDraft(
        context,
        owner,
        {
          contactId: acmeId,
          lines: [{ description: 'Pallet', quantity: '1', unitPriceMinor: '5000' }],
        },
        metadata,
      );
      await salesOrders.approve(context, owner, order.id, metadata);
      expect(await documents(grant)).toHaveLength(0);

      await salesOrders.confirm(context, owner, order.id, metadata);
      const confirmed = await harness.prisma.salesOrder.findUniqueOrThrow({
        where: { id: order.id },
      });
      expect(confirmed.portalVisibleAt).not.toBeNull();

      await salesOrders.cancel(context, owner, order.id, metadata);
      const visible = await documents(grant);
      expect(visible.map((document) => document.id)).toEqual([order.id]);
      expect(visible[0]?.status).toBe('CANCELLED');

      const reread = await harness.prisma.salesOrder.findUniqueOrThrow({ where: { id: order.id } });
      expect(reread.portalVisibleAt?.getTime()).toBe(confirmed.portalVisibleAt?.getTime());
    });

    it('never exposes another customer in the same tenant', async () => {
      const mine = await issuedInvoice(acmeId, '1200');
      const theirs = await issuedInvoice(betaId, '7800');

      expect((await documents(grant)).map((document) => document.id)).toEqual([mine]);
      await harness
        .http()
        .get(`${API}/portal/accounts/${grant}/documents/INVOICE/${theirs}`)
        .set('Cookie', customerCookie)
        .expect(404);
      await harness
        .http()
        .get(`${API}/portal/accounts/${grant}/documents/INVOICE/${theirs}/download`)
        .set('Cookie', customerCookie)
        .expect(404);
    });

    it('projects only customer-safe fields onto a document detail', async () => {
      const invoiceId = await issuedInvoice(acmeId, '2500');
      const response = await harness
        .http()
        .get(`${API}/portal/accounts/${grant}/documents/INVOICE/${invoiceId}`)
        .set('Cookie', customerCookie)
        .expect(200);

      const detail = (response.body as { data: Record<string, unknown> }).data;
      expect(Object.keys(detail).sort()).toEqual(
        [
          'currency',
          'dueDate',
          'id',
          'issueDate',
          'lines',
          'number',
          'status',
          'totalMinor',
          'type',
        ].sort(),
      );
      const line = (detail.lines as Array<Record<string, unknown>>)[0]!;
      expect(Object.keys(line).sort()).toEqual(
        ['description', 'discountMinor', 'quantity', 'totalMinor', 'unitPriceMinor'].sort(),
      );
    });

    it('issues a signed PDF download for a document the grant owns', async () => {
      const invoiceId = await issuedInvoice(acmeId, '3300');
      const response = await harness
        .http()
        .get(`${API}/portal/accounts/${grant}/documents/INVOICE/${invoiceId}/download`)
        .set('Cookie', customerCookie)
        .expect(200);

      const { downloadUrl } = (response.body as { data: { downloadUrl: string } }).data;
      expect(downloadUrl).toMatch(/^https?:\/\//);
      const stored = await fetch(downloadUrl);
      expect(stored.status).toBe(200);
      expect(Number(stored.headers.get('content-length'))).toBeGreaterThan(0);
    });
  });

  describe('quote decisions', () => {
    let grant: string;
    let quoteId: string;

    beforeEach(async () => {
      grant = await acceptInvitation(await inviteToken(acmeId, customer.email), customerCookie);
      quoteId = await sentQuote(acmeId);
    });

    it('records exactly one decision when two arrive at the same moment', async () => {
      const decide = (decision: 'accept' | 'decline') =>
        harness
          .http()
          .post(`${API}/portal/accounts/${grant}/quotes/${quoteId}/${decision}`)
          .set('Cookie', customerCookie);

      const results = await Promise.allSettled([decide('accept'), decide('decline')]);
      const statuses = results.map((result) =>
        result.status === 'fulfilled' ? result.value.status : 500,
      );
      expect(statuses.filter((status) => status === 201 || status === 200)).toHaveLength(1);
      expect(statuses.filter((status) => status === 404)).toHaveLength(1);

      const quote = await harness.prisma.quote.findUniqueOrThrow({ where: { id: quoteId } });
      expect(['ACCEPTED', 'DECLINED']).toContain(quote.status);

      const decisions = await harness.prisma.auditEvent.count({
        where: { entityId: quoteId, eventKey: { startsWith: 'portal.quote_' } },
      });
      expect(decisions).toBe(1);
    });

    it('attributes the decision to the portal grant and projects it as customer-visible activity', async () => {
      await harness
        .http()
        .post(`${API}/portal/accounts/${grant}/quotes/${quoteId}/accept`)
        .set('Cookie', customerCookie)
        .expect(201);

      const activity = await harness.prisma.activity.findFirstOrThrow({
        where: { targetId: quoteId, eventKey: 'portal.quote_accepted' },
      });
      expect(activity.visibility).toBe('CUSTOMER');
      expect(activity.portalUserId).toBe(grant);
      expect(activity.actorUserId).toBe(customer.id);
    });

    it('refuses a decision on a quote that is no longer awaiting one', async () => {
      await harness
        .http()
        .post(`${API}/portal/accounts/${grant}/quotes/${quoteId}/accept`)
        .set('Cookie', customerCookie)
        .expect(201);
      await harness
        .http()
        .post(`${API}/portal/accounts/${grant}/quotes/${quoteId}/decline`)
        .set('Cookie', customerCookie)
        .expect(404);
    });

    it("refuses a decision on another customer's quote", async () => {
      const foreign = await sentQuote(betaId);
      await harness
        .http()
        .post(`${API}/portal/accounts/${grant}/quotes/${foreign}/accept`)
        .set('Cookie', customerCookie)
        .expect(404);
    });
  });

  describe('statement and profile', () => {
    let grant: string;

    beforeEach(async () => {
      grant = await acceptInvitation(await inviteToken(acmeId, customer.email), customerCookie);
    });

    it("derives a statement that reconciles to the customer's outstanding invoice balance", async () => {
      const invoiceId = await issuedInvoice(acmeId, '10000');
      const payment = await payments.record(
        context,
        owner,
        { contactId: acmeId, receivedDate: '2026-02-02', amountMinor: '4000' },
        metadata,
      );
      await payments.allocate(
        context,
        owner,
        payment.id,
        { allocations: [{ invoiceId, amountMinor: '4000' }] },
        metadata,
      );

      const response = await harness
        .http()
        .get(`${API}/portal/accounts/${grant}/statement`)
        .set('Cookie', customerCookie)
        .expect(200);

      const statement = (
        response.body as {
          data: { summary: { closingBalanceMinor: string }; transactions: unknown[] };
        }
      ).data;
      const outstanding = await harness.prisma.invoice.aggregate({
        where: { organizationId: context.id, contactId: acmeId },
        _sum: { balanceMinor: true },
      });
      expect(statement.summary.closingBalanceMinor).toBe(
        (outstanding._sum.balanceMinor ?? 0n).toString(),
      );
      expect(statement.transactions.length).toBeGreaterThan(0);
    });

    it('exports the same statement as CSV, with the closing balance the API reported', async () => {
      await issuedInvoice(acmeId, '5000');
      const json = await harness
        .http()
        .get(`${API}/portal/accounts/${grant}/statement`)
        .set('Cookie', customerCookie)
        .expect(200);
      const closing = (json.body as { data: { summary: { closingBalanceMinor: string } } }).data
        .summary.closingBalanceMinor;

      const csv = await harness
        .http()
        .get(`${API}/portal/accounts/${grant}/statement/export`)
        .set('Cookie', customerCookie)
        .expect(200);

      expect(csv.headers['content-type']).toContain('text/csv');
      expect(csv.headers['content-disposition']).toContain('attachment; filename="statement-');
      expect(csv.text).toContain('Date,Description,Debit,Credit,Balance');
      expect(csv.text).toContain(`Closing balance,,,,${(Number(closing) / 100).toFixed(2)}`);
    });

    it('rejects a malformed statement window rather than silently ignoring it', async () => {
      await harness
        .http()
        .get(`${API}/portal/accounts/${grant}/statement?from=last-tuesday`)
        .set('Cookie', customerCookie)
        .expect(400);
    });

    it('updates customer-facing contact details without touching the sign-in identity', async () => {
      const response = await harness
        .http()
        .patch(`${API}/portal/accounts/${grant}/profile`)
        .set('Cookie', customerCookie)
        .send({
          displayName: 'Acme Retail (East)',
          email: 'billing@acme.example.test',
          phone: '+254700000000',
          addresses: [
            {
              kind: 'BILLING',
              line1: '1 Market Street',
              city: 'Nairobi',
              countryCode: 'ke',
              isDefault: true,
            },
            { kind: 'SHIPPING', line1: '2 Depot Road', countryCode: 'KE' },
          ],
        })
        .expect(200);

      const profile = (
        response.body as {
          data: {
            displayName: string;
            email: string;
            addresses: Array<{ kind: string; countryCode: string; isDefault: boolean }>;
          };
        }
      ).data;
      expect(profile.displayName).toBe('Acme Retail (East)');
      expect(profile.email).toBe('billing@acme.example.test');
      expect(profile.addresses).toHaveLength(2);
      expect(profile.addresses.find((address) => address.kind === 'BILLING')?.countryCode).toBe(
        'KE',
      );

      const signIn = await harness.prisma.user.findUniqueOrThrow({ where: { id: customer.id } });
      expect(signIn.email).toBe('buyer@example.test');

      const audited = await harness.prisma.auditEvent.findFirstOrThrow({
        where: { eventKey: 'portal.profile_updated', entityId: acmeId },
      });
      expect(audited.actorUserId).toBe(customer.id);
    });

    it('replaces the address set on each save rather than accumulating duplicates', async () => {
      const save = (addresses: unknown[]) =>
        harness
          .http()
          .patch(`${API}/portal/accounts/${grant}/profile`)
          .set('Cookie', customerCookie)
          .send({ addresses })
          .expect(200);

      await save([{ kind: 'BILLING', line1: 'First', countryCode: 'KE', isDefault: true }]);
      await save([{ kind: 'BILLING', line1: 'Second', countryCode: 'KE', isDefault: true }]);

      const stored = await harness.prisma.contactAddress.findMany({ where: { contactId: acmeId } });
      expect(stored).toHaveLength(1);
      expect(stored[0]?.line1).toBe('Second');
    });

    it('refuses two default addresses of the same kind', async () => {
      await harness
        .http()
        .patch(`${API}/portal/accounts/${grant}/profile`)
        .set('Cookie', customerCookie)
        .send({
          addresses: [
            { kind: 'BILLING', line1: 'One', countryCode: 'KE', isDefault: true },
            { kind: 'BILLING', line1: 'Two', countryCode: 'KE', isDefault: true },
          ],
        })
        .expect(409);
    });

    it('rejects profile fields the portal does not own', async () => {
      await harness
        .http()
        .patch(`${API}/portal/accounts/${grant}/profile`)
        .set('Cookie', customerCookie)
        .send({ currency: 'USD', status: 'INACTIVE' })
        .expect(400);
    });
  });

  describe('portal authorization boundary', () => {
    const OTHER = '00000000-0000-4000-8000-000000000009';

    /** Every account-scoped portal route, exercised against a grant the caller does not hold. */
    const ROUTES: ReadonlyArray<{ method: 'get' | 'post' | 'patch'; path: string }> = [
      { method: 'get', path: 'overview' },
      { method: 'get', path: 'documents' },
      { method: 'get', path: `documents/INVOICE/${OTHER}` },
      { method: 'get', path: `documents/INVOICE/${OTHER}/download` },
      { method: 'get', path: `documents/INVOICE/${OTHER}/comments` },
      { method: 'post', path: `documents/INVOICE/${OTHER}/comments` },
      { method: 'get', path: `documents/INVOICE/${OTHER}/attachments` },
      { method: 'post', path: `documents/INVOICE/${OTHER}/attachments` },
      { method: 'get', path: `documents/INVOICE/${OTHER}/attachments/${OTHER}/download` },
      { method: 'get', path: 'statement' },
      { method: 'get', path: 'statement/export' },
      { method: 'post', path: `quotes/${OTHER}/accept` },
      { method: 'post', path: `quotes/${OTHER}/decline` },
      { method: 'get', path: 'profile' },
      { method: 'patch', path: 'profile' },
    ];

    it('answers every account route with 401 when nobody is signed in', async () => {
      const grant = await acceptInvitation(
        await inviteToken(acmeId, customer.email),
        customerCookie,
      );
      for (const route of ROUTES) {
        const response = await harness
          .http()
          [route.method](`${API}/portal/accounts/${grant}/${route.path}`)
          .send({});
        expect(response.status, `${route.method} ${route.path}`).toBe(401);
      }
    });

    it('answers every account route with an identical not-found for a grant the caller does not hold', async () => {
      const stranger = await createUser('stranger@example.test', 'Stranger');
      const strangerCookie = await sessionCookieFor(stranger.id);
      const grant = await acceptInvitation(
        await inviteToken(acmeId, customer.email),
        customerCookie,
      );

      for (const route of ROUTES) {
        const foreign = await harness
          .http()
          [route.method](`${API}/portal/accounts/${grant}/${route.path}`)
          .set('Cookie', strangerCookie)
          .send({});
        const unknown = await harness
          .http()
          [route.method](`${API}/portal/accounts/${OTHER}/${route.path}`)
          .set('Cookie', strangerCookie)
          .send({});
        expect(foreign.status, `${route.method} ${route.path}`).toBe(404);
        expect(unknown.status, `${route.method} ${route.path}`).toBe(404);
        expect(foreign.body).toEqual(unknown.body);
      }
    });

    it('stops answering the moment the grant is revoked', async () => {
      const grant = await acceptInvitation(
        await inviteToken(acmeId, customer.email),
        customerCookie,
      );
      await issuedInvoice(acmeId, '1000');
      await harness
        .http()
        .get(`${API}/portal/accounts/${grant}/documents`)
        .set('Cookie', customerCookie)
        .expect(200);

      await portals.revokeUser(context.id, grant);

      for (const route of ROUTES) {
        const response = await harness
          .http()
          [route.method](`${API}/portal/accounts/${grant}/${route.path}`)
          .set('Cookie', customerCookie)
          .send({});
        expect(response.status, `${route.method} ${route.path}`).toBe(404);
      }
    });

    it('takes the grant with the customer when the contact record is removed', async () => {
      const grant = await acceptInvitation(
        await inviteToken(acmeId, customer.email),
        customerCookie,
      );
      await harness.prisma.contact.delete({ where: { id: acmeId } });

      expect(await harness.prisma.portalUser.count({ where: { id: grant } })).toBe(0);
      await harness
        .http()
        .get(`${API}/portal/accounts/${grant}/overview`)
        .set('Cookie', customerCookie)
        .expect(404);
    });
  });

  async function createUser(email: string, displayName: string): Promise<PublicUser> {
    const user = await harness.prisma.user.create({
      data: { email, displayName, emailVerifiedAt: new Date(), status: 'ACTIVE' },
    });
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      emailVerified: true,
      status: user.status,
    };
  }

  async function createActiveOrganization(
    user: PublicUser,
    legalName: string,
  ): Promise<OrganizationContext> {
    const created = await organizations.create(
      user,
      { legalName, businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    const draft = await access.requireMembership(user.id, created.id);
    await organizations.finalize(draft, user, metadata);
    return access.requireMembership(user.id, created.id);
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

  async function inviteToken(
    contactId: string,
    email: string,
    inviteContext: OrganizationContext = context,
    actor: PublicUser = owner,
  ): Promise<string> {
    await portals.invite(inviteContext, actor, contactId, email);
    const sent = sentTokens.at(-1);
    if (!sent) throw new Error('The invitation mailer was never called.');
    return sent.token;
  }

  async function acceptInvitation(token: string, cookie: string): Promise<string> {
    const response = await harness
      .http()
      .post(`${API}/portal-invitations/accept`)
      .set('Cookie', cookie)
      .send({ token })
      .expect(200);
    return (response.body as { data: { id: string } }).data.id;
  }

  async function listAccounts(cookie: string) {
    const response = await harness
      .http()
      .get(`${API}/portal/accounts`)
      .set('Cookie', cookie)
      .expect(200);
    return (response.body as { data: Array<{ id: string }> }).data;
  }

  async function documents(grant: string) {
    const response = await harness
      .http()
      .get(`${API}/portal/accounts/${grant}/documents`)
      .set('Cookie', customerCookie)
      .expect(200);
    return (response.body as { data: Array<{ id: string; type: string; status: string }> }).data;
  }

  async function issuedInvoice(contactId: string, unitPriceMinor: string): Promise<string> {
    const draft = await invoices.createDraft(
      context,
      owner,
      {
        contactId,
        lines: [{ description: 'Consulting', quantity: '1', unitPriceMinor }],
      },
      metadata,
    );
    await invoices.issueInvoice(context, owner, draft.id, metadata);
    return draft.id;
  }

  async function draftQuote(contactId: string): Promise<string> {
    const quote = await quotes.createDraft(
      context,
      owner,
      { contactId, lines: [{ description: 'Proposal', quantity: '1', unitPriceMinor: '2000' }] },
      metadata,
    );
    return quote.id;
  }

  async function sentQuote(contactId: string): Promise<string> {
    const quoteId = await draftQuote(contactId);
    await quotes.submitForApproval(context, owner, quoteId, metadata);
    await quotes.approve(context, owner, quoteId, metadata);
    await quotes.send(context, owner, quoteId, metadata);
    return quoteId;
  }
});
