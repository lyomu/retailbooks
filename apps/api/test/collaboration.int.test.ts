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
import { API, createTestHarness, type TestHarness } from './support/app.js';

const metadata = { ipHash: 'collaboration-test', userAgent: 'RetailBooks integration test' };

const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n', 'ascii'), Buffer.alloc(64, 0x20)]);

/**
 * Phase 11 collaboration acceptance: comments, files, and the activity timeline, exercised across
 * the internal and portal sides of the same target. The property under test is that visibility is a
 * stored fact enforced on read, not a filter the caller can influence.
 */
describe('collaboration comments, files, and activity against a real database', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let periods: FiscalPeriodsService;
  let customers: CustomersService;
  let invoices: InvoicesService;
  let portals: PortalsService;

  let owner: PublicUser;
  let ownerCookie: string;
  let context: OrganizationContext;
  let contactId: string;
  let invoiceId: string;
  let customer: PublicUser;
  let customerCookie: string;
  let grant: string;
  let sentTokens: string[];

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
    periods = harness.app.get(FiscalPeriodsService);
    customers = harness.app.get(CustomersService);
    invoices = harness.app.get(InvoicesService);
    portals = harness.app.get(PortalsService);

    const mailer = harness.app.get(AuthMailerService);
    const original = mailer.sendPortalInvitation.bind(mailer);
    mailer.sendPortalInvitation = async (invitation) => {
      sentTokens.push(invitation.token);
      await original(invitation);
    };
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    sentTokens = [];
    owner = await createUser('collab-owner@example.test', 'Collaboration Owner');
    ownerCookie = await sessionCookieFor(owner.id);
    context = await createActiveOrganization(owner, 'Collaboration Books Ltd');
    await periods.generateFiscalYear(context, owner, { startsOn: '2026-01-01' }, metadata);
    contactId = (await customers.create(context, owner, { displayName: 'Acme Retail' }, metadata))
      .id;
    invoiceId = await issuedInvoice(contactId);

    customer = await createUser('collab-buyer@example.test', 'Acme Buyer');
    customerCookie = await sessionCookieFor(customer.id);
    await portals.invite(context, owner, contactId, customer.email);
    const response = await harness
      .http()
      .post(`${API}/portal-invitations/accept`)
      .set('Cookie', customerCookie)
      .send({ token: sentTokens.at(-1) })
      .expect(200);
    grant = (response.body as { data: { id: string } }).data.id;
  });

  const internal = () => `${API}/organizations/${context.id}/collaboration/INVOICE/${invoiceId}`;
  const portal = () => `${API}/portal/accounts/${grant}/documents/INVOICE/${invoiceId}`;

  describe('comments', () => {
    it('keeps an internal comment internal: the customer never receives it', async () => {
      await harness
        .http()
        .post(`${internal()}/comments`)
        .set('Cookie', ownerCookie)
        .send({ body: 'Chase the margin on line 2 before we discount.' })
        .expect(201);

      const stored = await harness.prisma.comment.findFirstOrThrow();
      expect(stored.visibility).toBe('INTERNAL');

      const seen = await harness
        .http()
        .get(`${portal()}/comments`)
        .set('Cookie', customerCookie)
        .expect(200);
      expect((seen.body as { data: unknown[] }).data).toHaveLength(0);
    });

    it('shares an explicitly customer-visible comment with the customer, and only that one', async () => {
      await harness
        .http()
        .post(`${internal()}/comments`)
        .set('Cookie', ownerCookie)
        .send({ body: 'Internal: margin note.' })
        .expect(201);
      await harness
        .http()
        .post(`${internal()}/comments`)
        .set('Cookie', ownerCookie)
        .send({ body: 'Your invoice is ready.', visibility: 'CUSTOMER' })
        .expect(201);

      const seen = await harness
        .http()
        .get(`${portal()}/comments`)
        .set('Cookie', customerCookie)
        .expect(200);
      const comments = (seen.body as { data: Array<{ body: string; visibility: string }> }).data;
      expect(comments).toHaveLength(1);
      expect(comments[0]?.body).toBe('Your invoice is ready.');
      expect(comments[0]?.visibility).toBe('CUSTOMER');
    });

    it('refuses a customer-visible comment from a role without the visibility permission', async () => {
      // A role that can work the invoice and comment on it, but was never granted the right to
      // speak to the customer. None of the eight system roles is shaped that way, so this builds
      // the exact combination the rule exists for.
      const cookie = await customRoleCookie('Invoice Clerk', [
        'organization.view',
        'sales.invoices.view',
        'sales.invoices.manage',
        'collaboration.comments.create',
      ]);

      await harness
        .http()
        .post(`${internal()}/comments`)
        .set('Cookie', cookie)
        .send({ body: 'Internal only, please.' })
        .expect(201);
      await harness
        .http()
        .post(`${internal()}/comments`)
        .set('Cookie', cookie)
        .send({ body: 'Trying to reach the customer.', visibility: 'CUSTOMER' })
        .expect(404);

      expect(await harness.prisma.comment.count({ where: { visibility: 'CUSTOMER' } })).toBe(0);
    });

    it('forces a portal comment to be customer-visible and attributes it to the grant', async () => {
      await harness
        .http()
        .post(`${portal()}/comments`)
        .set('Cookie', customerCookie)
        .send({ body: 'Can we split this across two purchase orders?', visibility: 'INTERNAL' })
        .expect(201);

      const stored = await harness.prisma.comment.findFirstOrThrow();
      expect(stored.visibility).toBe('CUSTOMER');
      expect(stored.portalUserId).toBe(grant);
      expect(stored.authorUserId).toBe(customer.id);

      const internalView = await harness
        .http()
        .get(`${internal()}/comments`)
        .set('Cookie', ownerCookie)
        .expect(200);
      expect((internalView.body as { data: unknown[] }).data).toHaveLength(1);
    });

    it('refuses a comment on a target type customers can never reach', async () => {
      const bill = '00000000-0000-4000-8000-000000000004';
      await harness
        .http()
        .post(`${API}/organizations/${context.id}/collaboration/BILL/${bill}/comments`)
        .set('Cookie', ownerCookie)
        .send({ body: 'Share this with the customer.', visibility: 'CUSTOMER' })
        .expect(404);
    });

    it('refuses an unknown collaboration target type outright', async () => {
      await harness
        .http()
        .get(`${API}/organizations/${context.id}/collaboration/SECRET/${invoiceId}/comments`)
        .set('Cookie', ownerCookie)
        .expect(404);
    });
  });

  describe('files', () => {
    it('hides an internal attachment from the customer while showing a shared one', async () => {
      await harness
        .http()
        .post(`${internal()}/attachments`)
        .set('Cookie', ownerCookie)
        .attach('file', PDF, { filename: 'margin-analysis.pdf', contentType: 'application/pdf' })
        .expect(201);
      await harness
        .http()
        .post(`${portal()}/attachments`)
        .set('Cookie', customerCookie)
        .attach('file', PDF, { filename: 'purchase-order.pdf', contentType: 'application/pdf' })
        .expect(201);

      const customerView = await harness
        .http()
        .get(`${portal()}/attachments`)
        .set('Cookie', customerCookie)
        .expect(200);
      const visible = (customerView.body as { data: Array<{ filename: string }> }).data;
      expect(visible.map((file) => file.filename)).toEqual(['purchase-order.pdf']);

      const internalView = await harness
        .http()
        .get(`${internal()}/attachments`)
        .set('Cookie', ownerCookie)
        .expect(200);
      expect((internalView.body as { data: unknown[] }).data).toHaveLength(2);
    });

    it('refuses to issue a customer download link for an internal attachment', async () => {
      const upload = await harness
        .http()
        .post(`${internal()}/attachments`)
        .set('Cookie', ownerCookie)
        .attach('file', PDF, { filename: 'internal.pdf', contentType: 'application/pdf' })
        .expect(201);
      const attachmentId = (upload.body as { data: { id: string } }).data.id;

      await harness
        .http()
        .get(`${portal()}/attachments/${attachmentId}/download`)
        .set('Cookie', customerCookie)
        .expect(404);
      await harness
        .http()
        .get(`${internal()}/attachments/${attachmentId}/download`)
        .set('Cookie', ownerCookie)
        .expect(200);
    });

    it('never returns a download URL from a listing: the link is issued only on re-authorization', async () => {
      await harness
        .http()
        .post(`${internal()}/attachments`)
        .set('Cookie', ownerCookie)
        .attach('file', PDF, { filename: 'listed.pdf', contentType: 'application/pdf' })
        .expect(201);

      const listed = await harness
        .http()
        .get(`${internal()}/attachments`)
        .set('Cookie', ownerCookie)
        .expect(200);
      const rows = (listed.body as { data: Array<Record<string, unknown>> }).data;
      expect(rows[0]).not.toHaveProperty('downloadUrl');
      expect(Object.keys(rows[0]!).sort()).toEqual(
        ['contentType', 'createdAt', 'filename', 'id', 'sizeBytes'].sort(),
      );

      const issued = await harness
        .http()
        .get(`${internal()}/attachments/${rows[0]!.id as string}/download`)
        .set('Cookie', ownerCookie)
        .expect(200);
      expect((issued.body as { data: { downloadUrl: string } }).data.downloadUrl).toMatch(
        /^https?:\/\//,
      );
    });

    it('refuses an attachment id that belongs to a different target', async () => {
      const otherInvoice = await issuedInvoice(contactId);
      const upload = await harness
        .http()
        .post(`${internal()}/attachments`)
        .set('Cookie', ownerCookie)
        .attach('file', PDF, { filename: 'mine.pdf', contentType: 'application/pdf' })
        .expect(201);
      const attachmentId = (upload.body as { data: { id: string } }).data.id;

      await harness
        .http()
        .get(
          `${API}/organizations/${context.id}/collaboration/INVOICE/${otherInvoice}/attachments/${attachmentId}/download`,
        )
        .set('Cookie', ownerCookie)
        .expect(404);
    });

    it('rejects a file whose declared type its extension does not support', async () => {
      await harness
        .http()
        .post(`${internal()}/attachments`)
        .set('Cookie', ownerCookie)
        .attach('file', Buffer.from('MZ binary', 'ascii'), {
          filename: 'payload.exe',
          contentType: 'application/octet-stream',
        })
        .expect(400);
      expect(await harness.prisma.attachment.count()).toBe(0);
    });

    it('rejects a file whose bytes contradict its declared type', async () => {
      await harness
        .http()
        .post(`${internal()}/attachments`)
        .set('Cookie', ownerCookie)
        .attach('file', Buffer.from('not really a pdf', 'ascii'), {
          filename: 'invoice.pdf',
          contentType: 'application/pdf',
        })
        .expect(400);
      expect(await harness.prisma.attachment.count()).toBe(0);
    });

    it('applies the same validation to a portal upload', async () => {
      await harness
        .http()
        .post(`${portal()}/attachments`)
        .set('Cookie', customerCookie)
        .attach('file', Buffer.from('still not a pdf', 'ascii'), {
          filename: 'order.pdf',
          contentType: 'application/pdf',
        })
        .expect(400);
      expect(await harness.prisma.attachment.count()).toBe(0);
    });
  });

  describe('activity', () => {
    it('projects a recognised audit event into the target timeline exactly once', async () => {
      const timeline = await activity();
      const issued = timeline.filter((entry) => entry.eventKey === 'sales.invoice_issued');
      expect(issued).toHaveLength(1);
      expect(issued[0]?.visibility).toBe('INTERNAL');

      const row = await harness.prisma.activity.findFirstOrThrow({
        where: { targetId: invoiceId, eventKey: 'sales.invoice_issued' },
      });
      expect(row.auditEventId).not.toBeNull();
    });

    it('orders newest first and pages with a stable cursor that never repeats or skips a row', async () => {
      for (let index = 0; index < 60; index += 1) {
        await harness
          .http()
          .post(`${internal()}/comments`)
          .set('Cookie', ownerCookie)
          .send({ body: `Note ${index}` })
          .expect(201);
      }

      const first = await activityPage();
      expect(first.data).toHaveLength(50);
      expect(first.nextCursor).not.toBeNull();
      const occurred = first.data.map((entry) => Date.parse(entry.occurredAt));
      expect(occurred).toEqual([...occurred].sort((a, b) => b - a));

      const second = await activityPage(first.nextCursor ?? undefined);
      const ids = [...first.data, ...second.data].map((entry) => entry.id);
      expect(new Set(ids).size).toBe(ids.length);

      const total = await harness.prisma.activity.count({ where: { targetId: invoiceId } });
      expect(ids.length).toBe(total);
      expect(second.nextCursor).toBeNull();
    });

    it('rejects a cursor it did not issue rather than falling back to page one', async () => {
      await harness
        .http()
        .get(`${internal()}/activity?cursor=not-a-real-cursor`)
        .set('Cookie', ownerCookie)
        .expect(400);
    });

    it('shows the customer only their own side of the timeline', async () => {
      await harness
        .http()
        .post(`${internal()}/comments`)
        .set('Cookie', ownerCookie)
        .send({ body: 'Internal note.' })
        .expect(201);
      await harness
        .http()
        .post(`${portal()}/comments`)
        .set('Cookie', customerCookie)
        .send({ body: 'Customer question.' })
        .expect(201);

      const internalTimeline = await activity();
      const customerTimeline = await harness.prisma.activity.findMany({
        where: { targetId: invoiceId, visibility: 'CUSTOMER' },
      });
      expect(internalTimeline.length).toBeGreaterThan(customerTimeline.length);
      expect(customerTimeline).toHaveLength(1);
      expect(customerTimeline[0]?.portalUserId).toBe(grant);
    });

    it('keeps activity inside its tenant and its target', async () => {
      const otherOwner = await createUser('collab-other@example.test', 'Other Owner');
      const otherContext = await createActiveOrganization(otherOwner, 'Rival Books Ltd');

      await harness
        .http()
        .get(`${API}/organizations/${otherContext.id}/collaboration/INVOICE/${invoiceId}/activity`)
        .set('Cookie', await sessionCookieFor(otherOwner.id))
        .expect(404);

      const otherInvoiceTimeline = await harness
        .http()
        .get(
          `${API}/organizations/${context.id}/collaboration/INVOICE/${await issuedInvoice(contactId)}/activity`,
        )
        .set('Cookie', ownerCookie)
        .expect(200);
      const entries = (otherInvoiceTimeline.body as { data: Array<{ id: string }> }).data;
      const mine = await activity();
      expect(entries.some((entry) => mine.some((other) => other.id === entry.id))).toBe(false);
    });
  });

  describe('accountant multi-client access', () => {
    it('reports the role key per organization so a switcher can label each client', async () => {
      const accountant = await createUser('accountant@example.test', 'Client Accountant');
      const cookie = await sessionCookieFor(accountant.id);
      const second = await createActiveOrganization(owner, 'Second Client Ltd');
      await addMember(context, accountant, 'ACCOUNTANT');
      await addMember(second, accountant, 'ACCOUNTANT');

      const response = await harness
        .http()
        .get(`${API}/organizations`)
        .set('Cookie', cookie)
        .expect(200);
      const list = (
        response.body as { data: { organizations: Array<{ id: string; roleKey: string }> } }
      ).data.organizations;
      expect(list).toHaveLength(2);
      expect(list.every((organization) => organization.roleKey === 'ACCOUNTANT')).toBe(true);
    });

    it('scopes every read to the organization in the path, not to whichever was activated last', async () => {
      const accountant = await createUser('switcher@example.test', 'Switching Accountant');
      const cookie = await sessionCookieFor(accountant.id);
      const second = await createActiveOrganization(owner, 'Second Client Ltd');
      await addMember(context, accountant, 'ACCOUNTANT');
      await addMember(second, accountant, 'ACCOUNTANT');

      await harness
        .http()
        .post(`${API}/organizations/${context.id}/activate`)
        .set('Cookie', cookie)
        .expect(200);

      // Activation only records a preference. The path still decides the tenant, so the first
      // client's invoice must stay invisible while reading the second client.
      const secondClient = await harness
        .http()
        .get(`${API}/organizations/${second.id}/invoices`)
        .set('Cookie', cookie)
        .expect(200);
      expect((secondClient.body as { data: unknown[] }).data).toHaveLength(0);

      const firstClient = await harness
        .http()
        .get(`${API}/organizations/${context.id}/invoices`)
        .set('Cookie', cookie)
        .expect(200);
      expect((firstClient.body as { data: Array<{ id: string }> }).data).toHaveLength(1);

      await harness
        .http()
        .post(`${API}/organizations/${second.id}/activate`)
        .set('Cookie', cookie)
        .expect(200);
      const afterSwitch = await harness
        .http()
        .get(`${API}/organizations/${context.id}/invoices/${invoiceId}`)
        .set('Cookie', cookie)
        .expect(200);
      expect((afterSwitch.body as { data: { id: string } }).data.id).toBe(invoiceId);
    });

    it('leaves an accountant an ordinary member, with no portal grant of their own', async () => {
      const accountant = await createUser('plain@example.test', 'Plain Accountant');
      await addMember(context, accountant, 'ACCOUNTANT');
      const cookie = await sessionCookieFor(accountant.id);

      const accounts = await harness
        .http()
        .get(`${API}/portal/accounts`)
        .set('Cookie', cookie)
        .expect(200);
      expect((accounts.body as { data: unknown[] }).data).toHaveLength(0);

      await harness
        .http()
        .get(`${API}/portal/accounts/${grant}/overview`)
        .set('Cookie', cookie)
        .expect(404);
    });
  });

  async function activityPage(cursor?: string) {
    const response = await harness
      .http()
      .get(`${internal()}/activity${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`)
      .set('Cookie', ownerCookie)
      .expect(200);
    return response.body as {
      data: Array<{ id: string; eventKey: string; visibility: string; occurredAt: string }>;
      nextCursor: string | null;
    };
  }

  async function activity() {
    const page = await activityPage();
    return page.data;
  }

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

  async function addMember(
    target: OrganizationContext,
    user: PublicUser,
    roleKey: string,
  ): Promise<void> {
    const role = await harness.prisma.role.findFirstOrThrow({
      where: { organizationId: target.id, key: roleKey },
    });
    await harness.prisma.organizationMember.create({
      data: { organizationId: target.id, userId: user.id, roleId: role.id, status: 'ACTIVE' },
    });
  }

  /** Signs in a member holding a purpose-built role with exactly the permissions listed. */
  async function customRoleCookie(name: string, permissions: readonly string[]): Promise<string> {
    const role = await harness.prisma.role.create({
      data: {
        organizationId: context.id,
        key: name.toUpperCase().replaceAll(' ', '_'),
        name,
        description: `Test role: ${name}`,
        isSystem: false,
        isOwnerRole: false,
        permissions: { create: permissions.map((permissionKey) => ({ permissionKey })) },
      },
    });
    const user = await createUser(`${role.key.toLowerCase()}@example.test`, name);
    await harness.prisma.organizationMember.create({
      data: { organizationId: context.id, userId: user.id, roleId: role.id, status: 'ACTIVE' },
    });
    return sessionCookieFor(user.id);
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

  async function issuedInvoice(contact: string): Promise<string> {
    const draft = await invoices.createDraft(
      context,
      owner,
      {
        contactId: contact,
        lines: [{ description: 'Services', quantity: '1', unitPriceMinor: '2500' }],
      },
      metadata,
    );
    await invoices.issueInvoice(context, owner, draft.id, metadata);
    return draft.id;
  }
});
