import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createOpaqueToken, hashToken } from '../src/auth/auth.crypto.js';
import type { PublicUser } from '../src/auth/auth.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import type { OrganizationContext } from '../src/organizations/organization-context.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { CatalogService } from '../src/sales/catalog.service.js';
import { API, createTestHarness, type TestHarness } from './support/app.js';

const metadata = {
  ipHash: 'catalog-test',
  userAgent: 'RetailBooks integration test',
};

describe('catalog against a real database', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let catalog: CatalogService;
  let owner: PublicUser;
  let context: OrganizationContext;
  let cookie: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
    catalog = harness.app.get(CatalogService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    const user = await harness.prisma.user.create({
      data: {
        email: 'catalog-owner@example.test',
        displayName: 'Catalog Owner',
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
      { legalName: 'Catalog Books Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    const draftContext = await access.requireMembership(owner.id, created.id);
    await organizations.finalize(draftContext, owner, metadata);
    context = await access.requireMembership(owner.id, created.id);
    cookie = await sessionCookieFor(owner.id);
  });

  it('creates an item defaulting to the organization free-description preference', async () => {
    const created = await catalog.createItem(
      context,
      owner,
      { name: 'Consulting hour', itemType: 'SERVICE' },
      metadata,
    );
    expect(created.freeDescriptionAllowed).toBe(true);
    expect(created.status).toBe('ACTIVE');
  });

  it('rejects a second item with the same SKU in the same organization', async () => {
    await catalog.createItem(
      context,
      owner,
      { name: 'Widget', itemType: 'GOODS', sku: 'WID-1' },
      metadata,
    );

    await expect(
      catalog.createItem(
        context,
        owner,
        { name: 'Widget Two', itemType: 'GOODS', sku: 'WID-1' },
        metadata,
      ),
    ).rejects.toThrow('An item with this SKU already exists.');
  });

  it('allows two items with no SKU in the same organization', async () => {
    await expect(
      catalog.createItem(context, owner, { name: 'Widget A', itemType: 'GOODS' }, metadata),
    ).resolves.toBeDefined();
    await expect(
      catalog.createItem(context, owner, { name: 'Widget B', itemType: 'GOODS' }, metadata),
    ).resolves.toBeDefined();
  });

  it('rejects a negative unit price at the HTTP boundary', async () => {
    await harness
      .http()
      .post(`${API}/organizations/${context.id}/catalog/items`)
      .set('Cookie', cookie)
      .send({
        name: 'Discounted widget',
        itemType: 'GOODS',
        prices: [{ currency: 'KES', unitPriceMinor: '-500' }],
      })
      .expect(400);
  });

  it('accepts a zero-or-positive unit price at the HTTP boundary', async () => {
    const response = await harness
      .http()
      .post(`${API}/organizations/${context.id}/catalog/items`)
      .set('Cookie', cookie)
      .send({
        name: 'Free sample',
        itemType: 'GOODS',
        prices: [{ currency: 'KES', unitPriceMinor: '0' }],
      })
      .expect(201);

    const body = response.body as { data: { prices: { unitPriceMinor: string }[] } };
    expect(body.data.prices[0]?.unitPriceMinor).toBe('0');
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
});
