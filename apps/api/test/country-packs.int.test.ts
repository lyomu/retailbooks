import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createOpaqueToken, hashToken } from '../src/auth/auth.crypto.js';
import type { PublicUser } from '../src/auth/auth.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { API, createTestHarness, type TestHarness } from './support/app.js';

const metadata = {
  ipHash: 'country-packs-test',
  userAgent: 'RetailBooks integration test',
};

const PLATFORM_ADMIN_EMAIL = 'platform-admin@example.test';

type PackRow = {
  code: string;
  status: string;
  tier: string;
  name: string;
  taxPacks: {
    rates: { label: string; ratePercent: number; treatment: string; recoverable: boolean }[];
  }[];
};
type StatusView = { status: string };
type NameView = { name: string };
type ComplianceView = { status: string; packCode: string; packVersion: string; tier: string };
type DataOf<T> = { data: T };

const rwandaDraft = {
  code: 'RW',
  version: '2026.1-draft',
  countryCode: 'RW',
  name: 'Rwanda demonstration pack',
  tier: 'TIER_B_GENERIC',
  defaults: {
    currency: 'RWF',
    locale: 'en-RW',
    timeZone: 'Africa/Kigali',
    fiscalYearStartMonth: 1,
    fiscalYearStartDay: 1,
    chartTemplate: 'general-business',
    journalPrefix: 'JRN',
    numberPadding: 5,
    numberingReset: 'ANNUAL',
  },
  notes: ['Configurable software defaults only.'],
  supportedEntityTypes: ['INVOICE', 'BILL'],
  taxPack: {
    version: '2026.1-draft',
    name: 'Rwanda demonstration tax pack',
    rates: [{ label: 'VAT', ratePercent: 18, treatment: 'EXCLUSIVE', recoverable: true }],
  },
};

describe('country packs: admin lifecycle, compliance status, tier enforcement', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let owner: PublicUser;
  let organizationId: string;
  let cookie: string;
  let adminCookie: string;

  beforeAll(async () => {
    process.env.PLATFORM_ADMIN_EMAILS = PLATFORM_ADMIN_EMAIL;
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
  });

  afterAll(async () => {
    delete process.env.PLATFORM_ADMIN_EMAILS;
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    const user = await harness.prisma.user.create({
      data: {
        email: 'packs-owner@example.test',
        displayName: 'Packs Owner',
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
    const admin = await harness.prisma.user.create({
      data: {
        email: PLATFORM_ADMIN_EMAIL,
        displayName: 'Platform Admin',
        emailVerifiedAt: new Date(),
        status: 'ACTIVE',
      },
    });
    const created = await organizations.create(
      owner,
      { legalName: 'Pack Books Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    organizationId = created.id;
    const draftContext = await access.requireMembership(owner.id, created.id);
    await organizations.finalize(draftContext, owner, metadata);
    cookie = await sessionCookieFor(owner.id);
    adminCookie = await sessionCookieFor(admin.id);
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

  it('lists the seeded published packs with their tax packs', async () => {
    const response = await harness
      .http()
      .get(`${API}/localization/country-packs`)
      .set('Cookie', cookie)
      .expect(200);
    const packs = (response.body as DataOf<PackRow[]>).data;
    expect(packs.map((pack) => pack.code)).toContain('KE');
    expect(packs.map((pack) => pack.code)).toContain('GENERIC');
    const ke = packs.find((pack) => pack.code === 'KE');
    expect(ke?.tier).toBe('TIER_B_GENERIC');
    expect(ke?.taxPacks).toHaveLength(1);
    expect(ke?.taxPacks[0]?.rates).toEqual([
      { label: 'VAT', ratePercent: 16, treatment: 'EXCLUSIVE', recoverable: true },
    ]);
  });

  it('runs the full admin lifecycle: draft, edit, publish, deprecate', async () => {
    const created = await harness
      .http()
      .post(`${API}/localization/country-packs`)
      .set('Cookie', adminCookie)
      .send(rwandaDraft)
      .expect(201);
    expect((created.body as DataOf<StatusView>).data.status).toBe('DRAFT');

    // A draft is not yet publicly visible.
    const publishedBefore = await harness
      .http()
      .get(`${API}/localization/country-packs`)
      .set('Cookie', cookie)
      .expect(200);
    expect(
      (publishedBefore.body as DataOf<PackRow[]>).data.some((pack) => pack.code === 'RW'),
    ).toBe(false);

    await harness
      .http()
      .patch(`${API}/localization/country-packs/RW/versions/2026.1-draft`)
      .set('Cookie', adminCookie)
      .send({ name: 'Rwanda demonstration pack v2' })
      .expect(200)
      .then((response) =>
        expect((response.body as DataOf<NameView>).data.name).toBe('Rwanda demonstration pack v2'),
      );

    await harness
      .http()
      .post(`${API}/localization/country-packs/RW/versions/2026.1-draft/publish`)
      .set('Cookie', adminCookie)
      .expect(200)
      .then((response) =>
        expect((response.body as DataOf<StatusView>).data.status).toBe('PUBLISHED'),
      );

    // Published packs are read-only: edits and deletion are rejected, deprecation is the exit.
    await harness
      .http()
      .patch(`${API}/localization/country-packs/RW/versions/2026.1-draft`)
      .set('Cookie', adminCookie)
      .send({ name: 'Rewrite history' })
      .expect(409);
    await harness
      .http()
      .delete(`${API}/localization/country-packs/RW/versions/2026.1-draft`)
      .set('Cookie', adminCookie)
      .expect(409);
    await harness
      .http()
      .post(`${API}/localization/country-packs/RW/versions/2026.1-draft/deprecate`)
      .set('Cookie', adminCookie)
      .expect(200)
      .then((response) =>
        expect((response.body as DataOf<StatusView>).data.status).toBe('DEPRECATED'),
      );

    const publishedAfter = await harness
      .http()
      .get(`${API}/localization/country-packs`)
      .set('Cookie', cookie)
      .expect(200);
    expect((publishedAfter.body as DataOf<PackRow[]>).data.some((pack) => pack.code === 'RW')).toBe(
      false,
    );
  });

  it('rejects pack mutations without the platform-admin boundary', async () => {
    // A non-admin session on an allowlisted deployment.
    await harness
      .http()
      .post(`${API}/localization/country-packs`)
      .set('Cookie', cookie)
      .send(rwandaDraft)
      .expect(403);

    // A deployment that has not opted in has no platform administrators at all.
    const previous = process.env.PLATFORM_ADMIN_EMAILS;
    delete process.env.PLATFORM_ADMIN_EMAILS;
    try {
      await harness
        .http()
        .post(`${API}/localization/country-packs`)
        .set('Cookie', cookie)
        .send(rwandaDraft)
        .expect(403);
    } finally {
      process.env.PLATFORM_ADMIN_EMAILS = previous;
    }
  });

  it('surfaces the derived compliance status on organization detail', async () => {
    const response = await harness
      .http()
      .get(`${API}/organizations/${organizationId}`)
      .set('Cookie', cookie)
      .expect(200);
    const compliance = (response.body as DataOf<{ compliance: ComplianceView }>).data.compliance;
    expect(compliance).toMatchObject({
      status: 'GENERIC_CONFIGURATION',
      packCode: 'KE',
      packVersion: '2026.1-draft',
      tier: 'TIER_B_GENERIC',
    });
  });

  it('blocks compliance-sensitive tax setup for a Tier C pack and says Unsupported', async () => {
    await harness
      .http()
      .post(`${API}/localization/country-packs`)
      .set('Cookie', cookie)
      .send({
        ...rwandaDraft,
        code: 'BLOCKED',
        version: '1',
        name: 'Blocked demonstration pack',
        tier: 'TIER_C_BLOCKED',
      })
      .set('Cookie', adminCookie)
      .expect(201);
    await harness
      .http()
      .post(`${API}/localization/country-packs/BLOCKED/versions/1/publish`)
      .set('Cookie', adminCookie)
      .expect(200);
    await harness.prisma.organizationPreference.update({
      where: { organizationId },
      data: { countryPackCode: 'BLOCKED', countryPackVersion: '1' },
    });

    const detail = await harness
      .http()
      .get(`${API}/organizations/${organizationId}`)
      .set('Cookie', cookie)
      .expect(200);
    const compliance = (detail.body as DataOf<{ compliance: ComplianceView }>).data.compliance;
    expect(compliance.status).toBe('UNSUPPORTED');

    await harness
      .http()
      .patch(`${API}/organizations/${organizationId}`)
      .set('Cookie', cookie)
      .send({ section: 'TAX', taxRegistered: true })
      .expect(400);
  });
});
