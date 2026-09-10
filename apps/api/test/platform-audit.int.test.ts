import { ScheduledJobExecutionStatus } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createOpaqueToken, hashToken } from '../src/auth/auth.crypto.js';
import type { PublicUser } from '../src/auth/auth.service.js';
import { SchedulerService } from '../src/automation/scheduler.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { API, createTestHarness, type TestHarness } from './support/app.js';

const metadata = { ipHash: 'platform-audit-test', userAgent: 'platform-audit-test' };

describe('platform mutation audit coverage', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let scheduler: SchedulerService;
  let owner: PublicUser;
  let organizationId: string;
  let superadminId: string;
  let superadminGrantId: string;
  let superadminCookie: string;
  let operationsId: string;
  let operationsGrantId: string;
  let operationsCookie: string;
  let grantCandidateEmail: string;
  let managedUserId: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
    scheduler = harness.app.get(SchedulerService);
  });

  afterAll(async () => harness.close());

  beforeEach(async () => {
    await harness.reset();
    const [ownerRow, superadmin, operator, grantCandidate, managedUser] = await Promise.all([
      harness.prisma.user.create({
        data: {
          email: 'audit-owner@example.test',
          displayName: 'Audit Owner',
          emailVerifiedAt: new Date(),
          status: 'ACTIVE',
        },
      }),
      harness.prisma.user.create({
        data: {
          email: 'audit-superadmin@example.test',
          displayName: 'Audit Superadmin',
          emailVerifiedAt: new Date(),
          status: 'ACTIVE',
        },
      }),
      harness.prisma.user.create({
        data: {
          email: 'audit-operator@example.test',
          displayName: 'Audit Operator',
          emailVerifiedAt: new Date(),
          status: 'ACTIVE',
        },
      }),
      harness.prisma.user.create({
        data: {
          email: 'audit-grantee@example.test',
          displayName: 'Audit Grantee',
          emailVerifiedAt: new Date(),
          status: 'ACTIVE',
        },
      }),
      harness.prisma.user.create({
        data: {
          email: 'audit-managed-user@example.test',
          displayName: 'Audit Managed User',
          emailVerifiedAt: new Date(),
          status: 'ACTIVE',
        },
      }),
    ]);
    owner = {
      id: ownerRow.id,
      email: ownerRow.email,
      displayName: ownerRow.displayName,
      emailVerified: true,
      status: ownerRow.status,
    };
    const [superadminGrant, operationsGrant] = await Promise.all([
      harness.prisma.platformAdmin.create({ data: { userId: superadmin.id, role: 'SUPERADMIN' } }),
      harness.prisma.platformAdmin.create({ data: { userId: operator.id, role: 'OPERATIONS' } }),
    ]);
    superadminId = superadmin.id;
    superadminGrantId = superadminGrant.id;
    operationsId = operator.id;
    operationsGrantId = operationsGrant.id;
    grantCandidateEmail = grantCandidate.email;
    managedUserId = managedUser.id;
    [superadminCookie, operationsCookie] = await Promise.all([
      cookieFor(superadmin.id),
      cookieFor(operator.id),
    ]);
    const organization = await organizations.create(
      owner,
      { legalName: 'Audit Books Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    await organizations.finalize(
      await access.requireMembership(owner.id, organization.id),
      owner,
      metadata,
    );
    organizationId = organization.id;
  });

  it('writes actor, event, target, and reasons for every mutating platform action', async () => {
    const plan = await harness
      .http()
      .post(`${API}/platform/plans`)
      .set('Cookie', superadminCookie)
      .send({ key: 'audit-plan', name: 'Audit plan', priceMinor: '1000', currency: 'USD' })
      .expect(201)
      .then((response) => (response.body as { data: { id: string } }).data);
    await harness
      .http()
      .patch(`${API}/platform/plans/${plan.id}`)
      .set('Cookie', superadminCookie)
      .send({ name: 'Updated audit plan', status: 'ACTIVE' })
      .expect(200);
    await harness
      .http()
      .post(`${API}/platform/plans/${plan.id}/entitlements`)
      .set('Cookie', superadminCookie)
      .send({ key: 'audit.limit', enabled: true, limitValue: 4 })
      .expect(200);
    const entitlementId = await harness.prisma.planEntitlement
      .findUniqueOrThrow({ where: { planId_key: { planId: plan.id, key: 'audit.limit' } } })
      .then((row) => row.id);
    await harness
      .http()
      .delete(`${API}/platform/plans/${plan.id}/entitlements/audit.limit`)
      .set('Cookie', superadminCookie)
      .expect(204);

    await harness
      .http()
      .post(`${API}/platform/organizations/${organizationId}/suspend`)
      .set('Cookie', operationsCookie)
      .send({ reason: 'Audit suspension evidence.' })
      .expect(200);
    await harness
      .http()
      .post(`${API}/platform/organizations/${organizationId}/reactivate`)
      .set('Cookie', operationsCookie)
      .send({ reason: 'Audit reactivation evidence.' })
      .expect(200);
    await harness
      .http()
      .post(`${API}/platform/organizations/${organizationId}/plan`)
      .set('Cookie', superadminCookie)
      .send({ planId: plan.id, reason: 'Audit plan assignment evidence.' })
      .expect(200);
    await harness
      .http()
      .patch(`${API}/platform/users/${managedUserId}/status`)
      .set('Cookie', operationsCookie)
      .send({ status: 'SUSPENDED', reason: 'Audit user suspension evidence.' })
      .expect(200);

    const grant = await harness
      .http()
      .post(`${API}/platform/admins`)
      .set('Cookie', superadminCookie)
      .send({ email: grantCandidateEmail, role: 'SUPPORT', note: 'Audit grant evidence.' })
      .expect(201)
      .then((response) => (response.body as { data: { id: string } }).data);
    await harness
      .http()
      .delete(`${API}/platform/admins/${grant.id}`)
      .set('Cookie', superadminCookie)
      .expect(204);

    const flag = await harness
      .http()
      .post(`${API}/platform/feature-flags`)
      .set('Cookie', superadminCookie)
      .send({ key: 'audit.flag', name: 'Audit flag' })
      .expect(201)
      .then((response) => (response.body as { data: { id: string } }).data);
    await harness
      .http()
      .patch(`${API}/platform/feature-flags/${flag.id}`)
      .set('Cookie', superadminCookie)
      .send({ defaultEnabled: true })
      .expect(200);
    const rule = await harness
      .http()
      .post(`${API}/platform/feature-flags/${flag.id}/rules`)
      .set('Cookie', superadminCookie)
      .send({ scope: 'GLOBAL', enabled: false, note: 'Audit rule evidence.' })
      .expect(200)
      .then((response) => (response.body as { data: { id: string } }).data);
    await harness
      .http()
      .delete(`${API}/platform/feature-flags/rules/${rule.id}`)
      .set('Cookie', superadminCookie)
      .expect(204);

    const executionId = await createFailedExecution();
    await harness
      .http()
      .post(`${API}/platform/jobs/${executionId}/retry`)
      .set('Cookie', operationsCookie)
      .expect(200);

    const countryPack = countryPackInput('AUDIT', '1');
    const createdPack = await harness
      .http()
      .post(`${API}/localization/country-packs`)
      .set('Cookie', superadminCookie)
      .send(countryPack)
      .expect(201)
      .then((response) => (response.body as { data: { id: string } }).data);
    await harness
      .http()
      .patch(`${API}/localization/country-packs/AUDIT/versions/1`)
      .set('Cookie', superadminCookie)
      .send({ name: 'Updated audit country pack' })
      .expect(200);
    const taxPack = await harness
      .http()
      .patch(`${API}/localization/country-packs/AUDIT/versions/1`)
      .set('Cookie', superadminCookie)
      .send({
        taxPack: {
          version: '2',
          name: 'Audit tax pack v2',
          rates: [{ label: 'VAT', ratePercent: 18, treatment: 'EXCLUSIVE', recoverable: true }],
        },
      })
      .expect(200)
      .then((response) => {
        const taxPacks = (
          response.body as { data: { taxPacks: { id: string; version: string }[] } }
        ).data.taxPacks;
        const second = taxPacks.find((row) => row.version === '2');
        if (!second) throw new Error('Version 2 tax pack missing from the audit fixture.');
        return second;
      });
    await harness
      .http()
      .post(`${API}/localization/country-packs/AUDIT/versions/1/publish`)
      .set('Cookie', superadminCookie)
      .expect(200);
    await harness
      .http()
      .post(`${API}/localization/country-packs/AUDIT/versions/1/deprecate`)
      .set('Cookie', superadminCookie)
      .expect(200);
    const deletedPack = await harness
      .http()
      .post(`${API}/localization/country-packs`)
      .set('Cookie', superadminCookie)
      .send(countryPackInput('AUDDEL', '1'))
      .expect(201)
      .then((response) => (response.body as { data: { id: string } }).data);
    await harness
      .http()
      .delete(`${API}/localization/country-packs/AUDDEL/versions/1`)
      .set('Cookie', superadminCookie)
      .expect(200);

    const events = await harness.prisma.platformAuditEvent.findMany({
      where: { actorUserId: { in: [superadminId, operationsId] } },
      select: {
        actorUserId: true,
        platformAdminId: true,
        eventKey: true,
        targetType: true,
        targetId: true,
        organizationId: true,
        reason: true,
      },
    });
    expect(events).toEqual(
      expect.arrayContaining([
        audit('platform.plan_created', 'plan', plan.id),
        audit('platform.plan_updated', 'plan', plan.id),
        audit('platform.entitlement_updated', 'plan_entitlement', entitlementId),
        audit('platform.entitlement_removed', 'plan_entitlement', entitlementId),
        audit(
          'platform.plan_assigned',
          'organization',
          organizationId,
          'Audit plan assignment evidence.',
        ),
        audit('platform.admin_granted', 'platform_admin', grant.id, 'Audit grant evidence.'),
        audit('platform.admin_revoked', 'platform_admin', grant.id),
        audit('platform.feature_flag_created', 'feature_flag', flag.id),
        audit('platform.feature_flag_updated', 'feature_flag', flag.id),
        audit('platform.feature_flag_rule_set', 'feature_flag_rule', rule.id),
        audit('platform.feature_flag_rule_removed', 'feature_flag_rule', rule.id),
        audit('platform.country_pack_created', 'country_pack', createdPack.id),
        audit('platform.country_pack_updated', 'country_pack', createdPack.id),
        audit('platform.country_pack_tax_definition_upserted', 'tax_pack', taxPack.id),
        audit('platform.country_pack_published', 'country_pack', createdPack.id),
        audit('platform.country_pack_deprecated', 'country_pack', createdPack.id),
        audit('platform.country_pack_created', 'country_pack', deletedPack.id),
        audit('platform.country_pack_deleted', 'country_pack', deletedPack.id),
      ]),
    );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorUserId: operationsId,
          platformAdminId: operationsGrantId,
          eventKey: 'platform.organization_suspended',
          targetType: 'organization',
          targetId: organizationId,
          organizationId,
          reason: 'Audit suspension evidence.',
        }),
        expect.objectContaining({
          actorUserId: operationsId,
          platformAdminId: operationsGrantId,
          eventKey: 'platform.organization_reactivated',
          targetType: 'organization',
          targetId: organizationId,
          organizationId,
          reason: 'Audit reactivation evidence.',
        }),
        expect.objectContaining({
          actorUserId: operationsId,
          platformAdminId: operationsGrantId,
          eventKey: 'platform.user_status_changed',
          targetType: 'user',
          targetId: managedUserId,
          reason: 'Audit user suspension evidence.',
        }),
        expect.objectContaining({
          actorUserId: operationsId,
          platformAdminId: operationsGrantId,
          eventKey: 'platform.job_retried',
          targetType: 'scheduled_job_execution',
          targetId: executionId,
          organizationId,
        }),
      ]),
    );

    expect(events).toHaveLength(22);
  });

  function audit(eventKey: string, targetType: string, targetId: string, reason?: string) {
    return expect.objectContaining({
      actorUserId: superadminId,
      platformAdminId: superadminGrantId,
      eventKey,
      targetType,
      targetId,
      ...(reason === undefined ? {} : { reason }),
    }) as unknown;
  }

  async function createFailedExecution(): Promise<string> {
    const context = await access.requireMembership(owner.id, organizationId);
    const job = await scheduler.createJob({
      organizationId,
      createdByUserId: owner.id,
      handler: 'SCHEDULED_REPORT',
      sourceType: 'SCHEDULED_REPORT',
      sourceId: '00000000-0000-4000-8000-000000000001',
      schedule: { cadence: 'DAILY', localTime: '09:00' },
      timeZone: 'Africa/Nairobi',
    });
    const execution = await harness.prisma.scheduledJobExecution.create({
      data: {
        organizationId: context.id,
        scheduledJobId: job.id,
        occurrenceKey: '2099-01-01T09:00:00.000Z',
        status: ScheduledJobExecutionStatus.FAILED,
        startedAt: new Date('2099-01-01T09:00:01.000Z'),
        completedAt: new Date('2099-01-01T09:00:02.000Z'),
        attempts: 1,
        error: 'Audit retry fixture failed.',
      },
    });
    return execution.id;
  }

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

function countryPackInput(code: string, version: string) {
  return {
    code,
    version,
    countryCode: 'RW',
    name: `${code} audit country pack`,
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
    taxPack: {
      version: '1',
      name: `${code} audit tax pack`,
      rates: [{ label: 'VAT', ratePercent: 18, treatment: 'EXCLUSIVE', recoverable: true }],
    },
  };
}
