import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createOpaqueToken, hashToken } from '../src/auth/auth.crypto.js';
import type { PublicUser } from '../src/auth/auth.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { API, createTestHarness, type TestHarness } from './support/app.js';

const metadata = { ipHash: 'platform-operations-test', userAgent: 'platform-operations-test' };

describe('platform operations acceptance', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let owner: PublicUser;
  let organizationId: string;
  let ownerCookie: string;
  let operationsCookie: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
  });

  afterAll(async () => harness.close());

  beforeEach(async () => {
    await harness.reset();
    const ownerRow = await harness.prisma.user.create({
      data: {
        email: 'suspension-owner@example.test',
        displayName: 'Suspension Owner',
        emailVerifiedAt: new Date(),
        status: 'ACTIVE',
      },
    });
    owner = {
      id: ownerRow.id,
      email: ownerRow.email,
      displayName: ownerRow.displayName,
      emailVerified: true,
      status: ownerRow.status,
    };
    const created = await organizations.create(
      owner,
      { legalName: 'Suspension Books Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    await organizations.finalize(
      await access.requireMembership(owner.id, created.id),
      owner,
      metadata,
    );
    organizationId = created.id;
    ownerCookie = await cookieFor(owner.id);
    const operator = await harness.prisma.user.create({
      data: {
        email: 'operator@example.test',
        displayName: 'Operator',
        emailVerifiedAt: new Date(),
        status: 'ACTIVE',
      },
    });
    await harness.prisma.platformAdmin.create({
      data: { userId: operator.id, role: 'OPERATIONS' },
    });
    operationsCookie = await cookieFor(operator.id);
  });

  it('suspends without deleting tenant data, blocks tenant access, and restores it on reactivation', async () => {
    const before = await tenantFootprint();
    await harness
      .http()
      .post(`${API}/platform/organizations/${organizationId}/suspend`)
      .set('Cookie', operationsCookie)
      .send({ reason: 'Evidence suspension for verification.' })
      .expect(200);
    await harness
      .http()
      .get(`${API}/organizations/${organizationId}`)
      .set('Cookie', ownerCookie)
      .expect(403);
    expect(await tenantFootprint()).toEqual({ ...before, status: 'SUSPENDED' });
    await harness
      .http()
      .post(`${API}/platform/organizations/${organizationId}/reactivate`)
      .set('Cookie', operationsCookie)
      .send({ reason: 'Verification complete.' })
      .expect(200);
    await harness
      .http()
      .get(`${API}/organizations/${organizationId}`)
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(await tenantFootprint()).toEqual({ ...before, status: 'ACTIVE' });
    const audit = await harness.prisma.platformAuditEvent.findMany({
      where: { organizationId },
      orderBy: { occurredAt: 'asc' },
      select: { eventKey: true, reason: true },
    });
    expect(audit).toEqual([
      {
        eventKey: 'platform.organization_suspended',
        reason: 'Evidence suspension for verification.',
      },
      { eventKey: 'platform.organization_reactivated', reason: 'Verification complete.' },
    ]);
  });

  it('reconciles analytics to direct counts and returns no monetary fields', async () => {
    const response = await harness
      .http()
      .get(`${API}/platform/analytics`)
      .set('Cookie', operationsCookie)
      .expect(200);
    const { data } = response.body as { data: Record<string, unknown> };
    expect(data.organizations).toMatchObject({
      total: await harness.prisma.organization.count(),
      active: await harness.prisma.organization.count({ where: { status: 'ACTIVE' } }),
    });
    expect(data.users).toMatchObject({
      total: await harness.prisma.user.count(),
      active: await harness.prisma.user.count({ where: { status: 'ACTIVE' } }),
    });
    expect(forbiddenMoneyKeys(data)).toEqual([]);
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

  async function tenantFootprint() {
    const [organization, members, preferences, accounts] = await Promise.all([
      harness.prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { status: true, legalName: true },
      }),
      harness.prisma.organizationMember.count({ where: { organizationId } }),
      harness.prisma.organizationPreference.count({ where: { organizationId } }),
      harness.prisma.ledgerAccount.count({ where: { organizationId } }),
    ]);
    return {
      status: organization.status,
      legalName: organization.legalName,
      members,
      preferences,
      accounts,
    };
  }
});

function forbiddenMoneyKeys(value: unknown, path = ''): string[] {
  if (!value || typeof value !== 'object') return [];
  const problems: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = path ? `${path}.${key}` : key;
    if (/^(amount|balance|price|priceMinor|currency|totalMinor)$/i.test(key))
      problems.push(childPath);
    problems.push(...forbiddenMoneyKeys(child, childPath));
  }
  return problems;
}
