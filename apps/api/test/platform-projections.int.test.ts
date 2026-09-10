import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createOpaqueToken, hashToken } from '../src/auth/auth.crypto.js';
import type { PublicUser } from '../src/auth/auth.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { API, createTestHarness, type TestHarness } from './support/app.js';

const metadata = { ipHash: 'platform-projections-test', userAgent: 'platform-projections-test' };

describe('platform response projections', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let organizationId: string;
  let ownerId: string;
  let supportCookie: string;
  let superadminCookie: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
  });

  afterAll(async () => harness.close());

  beforeEach(async () => {
    await harness.reset();
    const owner = await harness.prisma.user.create({
      data: {
        email: 'projection-owner@example.test',
        displayName: 'Projection Owner',
        emailVerifiedAt: new Date(),
        status: 'ACTIVE',
      },
    });
    ownerId = owner.id;
    const publicOwner: PublicUser = {
      id: owner.id,
      email: owner.email,
      displayName: owner.displayName,
      emailVerified: true,
      status: owner.status,
    };
    const organization = await organizations.create(
      publicOwner,
      { legalName: 'Projection Books Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    await organizations.finalize(
      await access.requireMembership(owner.id, organization.id),
      publicOwner,
      metadata,
    );
    organizationId = organization.id;

    const support = await harness.prisma.user.create({
      data: {
        email: 'projection-support@example.test',
        displayName: 'Projection Support',
        emailVerifiedAt: new Date(),
        status: 'ACTIVE',
      },
    });
    const superadmin = await harness.prisma.user.create({
      data: {
        email: 'projection-superadmin@example.test',
        displayName: 'Projection Superadmin',
        emailVerifiedAt: new Date(),
        status: 'ACTIVE',
      },
    });
    await harness.prisma.platformAdmin.createMany({
      data: [
        { userId: support.id, role: 'SUPPORT' },
        { userId: superadmin.id, role: 'SUPERADMIN' },
      ],
    });
    [supportCookie, superadminCookie] = await Promise.all([
      cookieFor(support.id),
      cookieFor(superadmin.id),
    ]);
    await harness.prisma.featureFlag.create({
      data: { key: 'projection.flag', name: 'Projection flag' },
    });
  });

  it('never projects tenant financial data from platform read surfaces', async () => {
    const reads = [
      [`${API}/platform/me`, supportCookie],
      [`${API}/platform/organizations`, supportCookie],
      [`${API}/platform/organizations/${organizationId}`, supportCookie],
      [`${API}/platform/organizations/${organizationId}/entitlements`, supportCookie],
      [`${API}/platform/users`, supportCookie],
      [`${API}/platform/users/${ownerId}`, supportCookie],
      [`${API}/platform/feature-flags`, supportCookie],
      [`${API}/platform/feature-flags/projection.flag/preview?countryCode=KE`, supportCookie],
      [`${API}/platform/jobs/health`, supportCookie],
      [`${API}/platform/jobs/failed`, supportCookie],
      [`${API}/platform/security-events`, supportCookie],
      [`${API}/platform/audit`, supportCookie],
      [`${API}/platform/analytics`, supportCookie],
      [`${API}/platform/admins`, superadminCookie],
      [`${API}/localization/country-packs/admin/all`, superadminCookie],
    ] as const;

    for (const [path, cookie] of reads) {
      const response = await harness.http().get(path).set('Cookie', cookie).expect(200);
      expect(forbiddenTenantFinancialPaths(response.body), path).toEqual([]);
    }

    // Plans intentionally carry the global catalogue price, currency, and billing interval. Those
    // fields describe what RetailBooks sells, not a tenant's invoices, journals, or balances.
    await harness
      .http()
      .get(`${API}/platform/plans`)
      .set('Cookie', supportCookie)
      .expect(200)
      .then((response) => expect(response.body.data[0]).toHaveProperty('priceMinor'));
  });

  async function cookieFor(userId: string): Promise<string> {
    const token = createOpaqueToken();
    await harness.prisma.session.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        userAgent: metadata.userAgent,
        ipHash: metadata.ipHash,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    return `rb_session=${token}`;
  }
});

function forbiddenTenantFinancialPaths(value: unknown, path = ''): string[] {
  if (!value || typeof value !== 'object') return [];
  const forbidden: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = path ? `${path}.${key}` : key;
    if (/^(amount|amountMinor|balance|balanceMinor|debit|debitMinor|credit|creditMinor|total|totalMinor|subtotal|subtotalMinor|paidMinor|dueMinor|outstandingMinor)$/i.test(key)) {
      forbidden.push(childPath);
    }
    if (/^(invoices|bills|journals|payments|statements|ledgerRows|ledgerAccounts)$/i.test(key)) {
      if (Array.isArray(child) || (child !== null && typeof child === 'object')) forbidden.push(childPath);
    }
    forbidden.push(...forbiddenTenantFinancialPaths(child, childPath));
  }
  return forbidden;
}
