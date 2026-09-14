import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createOpaqueToken, hashToken } from '../src/auth/auth.crypto.js';
import type { PublicUser } from '../src/auth/auth.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { PHASE13_FEATURE_FLAGS } from '../src/platform/phase13-feature-flags.js';
import { API, createTestHarness, type TestHarness } from './support/app.js';

const metadata = { ipHash: 'phase13-flags-test', userAgent: 'RetailBooks flag integration test' };

/**
 * Proves 13G's core acceptance criterion end to end over real HTTP: a Phase 13 route reachable by a
 * fully-permissioned caller today can be turned off with an immediate kill switch (no redeploy, no
 * code change) and, separately, can be enabled for one pilot organization while staying off for
 * everyone else. The route under test (`insights/variance`) is otherwise covered for permission/
 * tenant-isolation correctness in authorization-boundary.int.test.ts; this file is only about the
 * flag layer sitting in front of it.
 */
describe('Phase 13 feature-flag rollout mechanism against a real database', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let owner: PublicUser;
  let organizationId: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
  });

  afterAll(async () => harness.close());

  beforeEach(async () => {
    await harness.reset();
    const user = await harness.prisma.user.create({
      data: {
        email: 'flag-owner@example.test',
        displayName: 'Flag Owner',
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
      { legalName: 'Flag Rollout Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    const draft = await access.requireMembership(owner.id, created.id);
    await organizations.finalize(draft, owner, metadata);
    organizationId = created.id;
  });

  it('reaches the route by default -- the flag is seeded ACTIVE and default-enabled', async () => {
    const cookie = await cookieFor(owner.id);
    await harness
      .http()
      .get(`${API}/organizations/${organizationId}/insights/variance`)
      .set('Cookie', cookie)
      .expect(200);
  });

  it('is an immediate kill switch: flipping default_enabled off 403s the route for a caller who still holds the permission', async () => {
    const cookie = await cookieFor(owner.id);
    await harness.prisma.featureFlag.update({
      where: { key: PHASE13_FEATURE_FLAGS.AI_SUGGESTIONS },
      data: { defaultEnabled: false },
    });

    const response = await harness
      .http()
      .get(`${API}/organizations/${organizationId}/insights/variance`)
      .set('Cookie', cookie)
      .expect(403);
    expect((response.body as { error: { message: string } }).error.message).toMatch(/not enabled/i);
  });

  it('re-enables the route once the flag is switched back on', async () => {
    const cookie = await cookieFor(owner.id);
    await harness.prisma.featureFlag.update({
      where: { key: PHASE13_FEATURE_FLAGS.AI_SUGGESTIONS },
      data: { defaultEnabled: false },
    });
    await harness
      .http()
      .get(`${API}/organizations/${organizationId}/insights/variance`)
      .set('Cookie', cookie)
      .expect(403);

    await harness.prisma.featureFlag.update({
      where: { key: PHASE13_FEATURE_FLAGS.AI_SUGGESTIONS },
      data: { defaultEnabled: true },
    });
    await harness
      .http()
      .get(`${API}/organizations/${organizationId}/insights/variance`)
      .set('Cookie', cookie)
      .expect(200);
  });

  it('fails closed when the flag is archived, not treated as still-on', async () => {
    const cookie = await cookieFor(owner.id);
    await harness.prisma.featureFlag.update({
      where: { key: PHASE13_FEATURE_FLAGS.AI_SUGGESTIONS },
      data: { status: 'ARCHIVED' },
    });

    await harness
      .http()
      .get(`${API}/organizations/${organizationId}/insights/variance`)
      .set('Cookie', cookie)
      .expect(403);
  });

  it('supports a pilot-tenant rollout: off globally, on for one organization via an ORGANIZATION-scope rule', async () => {
    const cookie = await cookieFor(owner.id);

    const otherOwnerUser = await harness.prisma.user.create({
      data: {
        email: 'flag-other-owner@example.test',
        displayName: 'Other Flag Owner',
        emailVerifiedAt: new Date(),
        status: 'ACTIVE',
      },
    });
    const otherOwner: PublicUser = {
      id: otherOwnerUser.id,
      email: otherOwnerUser.email,
      displayName: otherOwnerUser.displayName,
      emailVerified: true,
      status: otherOwnerUser.status,
    };
    const otherCreated = await organizations.create(
      otherOwner,
      { legalName: 'Not Piloted Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    const otherDraft = await access.requireMembership(otherOwner.id, otherCreated.id);
    await organizations.finalize(otherDraft, otherOwner, metadata);
    const otherCookie = await cookieFor(otherOwner.id);

    const flag = await harness.prisma.featureFlag.update({
      where: { key: PHASE13_FEATURE_FLAGS.AI_SUGGESTIONS },
      data: { defaultEnabled: false },
    });
    await harness.prisma.featureFlagRule.create({
      data: { flagId: flag.id, scope: 'ORGANIZATION', organizationId, enabled: true },
    });

    await harness
      .http()
      .get(`${API}/organizations/${organizationId}/insights/variance`)
      .set('Cookie', cookie)
      .expect(200);
    await harness
      .http()
      .get(`${API}/organizations/${otherCreated.id}/insights/variance`)
      .set('Cookie', otherCookie)
      .expect(403);
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
