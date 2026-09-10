import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createOpaqueToken, hashToken } from '../src/auth/auth.crypto.js';
import type { PublicUser } from '../src/auth/auth.service.js';
import { EntitlementsService } from '../src/platform/entitlements.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { API, createTestHarness, type TestHarness } from './support/app.js';

const metadata = { ipHash: 'platform-resolution-test', userAgent: 'platform-resolution-test' };

describe('platform entitlement and feature-flag resolution', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let entitlements: EntitlementsService;
  let owner: PublicUser;
  let organizationId: string;
  let planId: string;
  let superadminCookie: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
    entitlements = harness.app.get(EntitlementsService);
  });

  afterAll(async () => harness.close());

  beforeEach(async () => {
    await harness.reset();
    const user = await harness.prisma.user.create({
      data: {
        email: 'resolver@example.test',
        displayName: 'Resolver',
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
    const organization = await organizations.create(
      owner,
      { legalName: 'Resolution Books Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    await organizations.finalize(
      await access.requireMembership(owner.id, organization.id),
      owner,
      metadata,
    );
    organizationId = organization.id;
    const plan = await harness.prisma.plan.create({
      data: { key: 'resolution', name: 'Resolution', status: 'ACTIVE', priceMinor: 0n },
    });
    planId = plan.id;
    await harness.prisma.organizationSubscription.create({
      data: {
        organizationId,
        planId,
        status: 'TRIALING',
        trialEndsAt: new Date('2099-01-01T00:00:00Z'),
      },
    });
    const superadmin = await harness.prisma.user.create({
      data: {
        email: 'resolver-superadmin@example.test',
        displayName: 'Resolver Superadmin',
        emailVerifiedAt: new Date(),
        status: 'ACTIVE',
      },
    });
    await harness.prisma.platformAdmin.create({
      data: { userId: superadmin.id, role: 'SUPERADMIN' },
    });
    superadminCookie = await cookieFor(superadmin.id);
  });

  it('uses organization, plan, country, global, then default precedence across all feature-flag scopes', async () => {
    const flag = await harness.prisma.featureFlag.create({
      data: { key: 'resolution.flag', name: 'Resolution flag', defaultEnabled: true },
    });
    const rules = [
      { scope: 'GLOBAL' as const, enabled: false },
      { scope: 'COUNTRY' as const, enabled: true, countryCode: 'KE' },
      { scope: 'PLAN' as const, enabled: false, planId },
      { scope: 'ORGANIZATION' as const, enabled: true, organizationId },
    ];
    for (const rule of rules)
      await harness.prisma.featureFlagRule.create({ data: { flagId: flag.id, ...rule } });

    const resolved = async () => (await entitlements.forOrganization(organizationId)).flags[0];
    await expect(resolved()).resolves.toMatchObject({ enabled: true, decidedBy: 'ORGANIZATION' });
    await harness.prisma.featureFlagRule.deleteMany({
      where: { flagId: flag.id, scope: 'ORGANIZATION' },
    });
    await expect(resolved()).resolves.toMatchObject({ enabled: false, decidedBy: 'PLAN' });
    await harness.prisma.featureFlagRule.deleteMany({ where: { flagId: flag.id, scope: 'PLAN' } });
    await expect(resolved()).resolves.toMatchObject({ enabled: true, decidedBy: 'COUNTRY' });
    await harness.prisma.featureFlagRule.deleteMany({
      where: { flagId: flag.id, scope: 'COUNTRY' },
    });
    await expect(resolved()).resolves.toMatchObject({ enabled: false, decidedBy: 'GLOBAL' });
    await harness.prisma.featureFlagRule.deleteMany({ where: { flagId: flag.id } });
    await expect(resolved()).resolves.toMatchObject({ enabled: true, decidedBy: 'DEFAULT' });
  });

  it('retains explicit limits, unlimited entitlements, and trial standing', async () => {
    await harness.prisma.planEntitlement.createMany({
      data: [
        { planId, key: 'capped', enabled: true, limitValue: 25 },
        { planId, key: 'unlimited', enabled: true, limitValue: null },
        { planId, key: 'disabled', enabled: false, limitValue: 0 },
      ],
    });
    const resolved = await entitlements.forOrganization(organizationId);
    expect(resolved.subscription).toEqual({
      status: 'TRIALING',
      trialEndsAt: '2099-01-01T00:00:00.000Z',
    });
    expect(resolved.entitlements).toEqual([
      { key: 'capped', enabled: true, limitValue: 25 },
      { key: 'disabled', enabled: false, limitValue: 0 },
      { key: 'unlimited', enabled: true, limitValue: null },
    ]);
  });

  it('replaces a matching feature-flag rule instead of duplicating a scope target', async () => {
    const flag = await harness.prisma.featureFlag.create({
      data: { key: 'repeat.flag', name: 'Repeat flag', defaultEnabled: true },
    });
    const first = await harness
      .http()
      .post(`${API}/platform/feature-flags/${flag.id}/rules`)
      .set('Cookie', superadminCookie)
      .send({ scope: 'GLOBAL', enabled: true, note: 'initial decision' })
      .expect(200)
      .then((response) => (response.body as { data: { id: string } }).data);
    const second = await harness
      .http()
      .post(`${API}/platform/feature-flags/${flag.id}/rules`)
      .set('Cookie', superadminCookie)
      .send({ scope: 'GLOBAL', enabled: false, note: 'replacement decision' })
      .expect(200)
      .then((response) => (response.body as { data: { id: string } }).data);

    expect(second.id).toBe(first.id);
    await expect(
      harness.prisma.featureFlagRule.findMany({ where: { flagId: flag.id, scope: 'GLOBAL' } }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: first.id,
        enabled: false,
        note: 'replacement decision',
      }),
    ]);
    await expect(entitlements.forOrganization(organizationId)).resolves.toMatchObject({
      flags: [{ key: 'repeat.flag', enabled: false, decidedBy: 'GLOBAL' }],
    });
    await harness
      .http()
      .get(`${API}/platform/feature-flags/repeat.flag/preview`)
      .set('Cookie', superadminCookie)
      .expect(200)
      .then((response) =>
        expect((response.body as { data: Record<string, unknown> }).data).toEqual({
          key: 'repeat.flag',
          enabled: false,
          decidedBy: 'GLOBAL',
        }),
      );
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
