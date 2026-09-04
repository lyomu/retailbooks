import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createOpaqueToken, hashToken } from '../src/auth/auth.crypto.js';
import type { PublicUser } from '../src/auth/auth.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import type { OrganizationContext } from '../src/organizations/organization-context.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { API, createTestHarness, type TestHarness } from './support/app.js';

const metadata = {
  ipHash: 'compliance-claims-test',
  userAgent: 'RetailBooks integration test',
};

describe('unsupported-jurisdiction compliance claims never render', () => {
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
        email: 'compliance-claims-owner@example.test',
        displayName: 'Compliance Claims Owner',
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
      { legalName: 'Compliance Claims Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    const draftContext = await access.requireMembership(owner.id, created.id);
    await organizations.finalize(draftContext, owner, metadata);
    context = await access.requireMembership(owner.id, created.id);
    cookie = await sessionCookieFor(owner.id);
  });

  it('blocks tax registration for an unsupported jurisdiction', async () => {
    // Simulate an org whose pinned pack resolves to UNSUPPORTED: point the preference at a
    // non-existent pack code. The compliance resolver has no DB row and no catalog fallback for
    // this code, so it resolves to UNSUPPORTED -- exactly the posture that must never imply compliance.
    await harness.prisma.organizationPreference.update({
      where: { organizationId: context.id },
      data: { countryPackCode: 'ZZ', countryPackVersion: '2026.1-nope' },
    });

    // Compliance-sensitive tax setup (registering for tax) must be rejected -- the badge says
    // "Unsupported" and the API must agree, never imply compliance where unreviewed.
    await harness
      .http()
      .patch(`${API}/organizations/${context.id}`)
      .set('Cookie', cookie)
      .send({ section: 'TAX', taxRegistered: true })
      .expect(400);

    // Recording a tax identifier is equally compliance-sensitive and must also be blocked.
    await harness
      .http()
      .patch(`${API}/organizations/${context.id}`)
      .set('Cookie', cookie)
      .send({ section: 'TAX', taxIdentifier: 'SOME-ID-123' })
      .expect(400);

    // The preference must remain unregistered -- the rejected writes must not have partial-applied.
    const preference = await harness.prisma.organizationPreference.findUniqueOrThrow({
      where: { organizationId: context.id },
    });
    expect(preference.taxRegistered).toBe(false);
    expect(preference.taxIdentifier).toBeNull();
  });

  it('surfaces UNSUPPORTED compliance on the organization detail', async () => {
    await harness.prisma.organizationPreference.update({
      where: { organizationId: context.id },
      data: { countryPackCode: 'ZZ', countryPackVersion: '2026.1-nope' },
    });

    const detail = await organizations.detail(context);
    expect(detail.compliance.status).toBe('UNSUPPORTED');
    // The pinned pack name is unknown for an unsupported jurisdiction -- the detail must not
    // fabricate one.
    expect(detail.compliance.packName).toBeNull();
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
