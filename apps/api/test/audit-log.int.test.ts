import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PublicUser } from '../src/auth/auth.service.js';
import { AuditLogService } from '../src/organizations/audit-log.service.js';
import type { OrganizationContext } from '../src/organizations/organization-context.js';
import { OrganizationMembersService } from '../src/organizations/organization-members.service.js';
import { RolesService } from '../src/organizations/roles.service.js';
import { createTestHarness, type TestHarness } from './support/app.js';

describe('audit log against a real database', () => {
  let harness: TestHarness;
  let members: OrganizationMembersService;
  let auditLogService: AuditLogService;
  let roles: RolesService;
  let organizationId: string;
  let organizationRoles: ReadonlyMap<string, { id: string }>;
  let ownerUser: PublicUser;

  beforeAll(async () => {
    harness = await createTestHarness();
    members = harness.app.get(OrganizationMembersService);
    auditLogService = harness.app.get(AuditLogService);
    roles = harness.app.get(RolesService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();

    const owner = await harness.prisma.user.create({
      data: { email: 'owner@example.com', displayName: 'Owner', emailVerifiedAt: new Date() },
    });
    ownerUser = {
      id: owner.id,
      email: owner.email,
      displayName: owner.displayName,
      emailVerified: true,
      status: owner.status,
    };
    const organization = await harness.prisma.organization.create({
      data: {
        legalName: 'Demo Ltd',
        slug: 'demo-ltd',
        countryCode: 'KE',
        baseCurrency: 'KES',
        timeZone: 'Africa/Nairobi',
        locale: 'en-KE',
        createdByUserId: owner.id,
        preferences: {
          create: {
            chartTemplate: 'general-business',
            countryPackCode: 'KE',
            countryPackVersion: '1.0.0',
          },
        },
      },
    });
    organizationId = organization.id;
    organizationRoles = await harness.prisma.$transaction((tx) =>
      roles.seedSystemRoles(tx, organizationId),
    );
  });

  it('records before/after values on a role change and reads them back merged with security events', async () => {
    const viewerRoleId = organizationRoles.get('VIEWER')!.id;
    const accountantRoleId = organizationRoles.get('ACCOUNTANT')!.id;

    const staffUser = await harness.prisma.user.create({
      data: { email: 'staff@example.com', displayName: 'Staff', emailVerifiedAt: new Date() },
    });
    const member = await harness.prisma.organizationMember.create({
      data: { organizationId, userId: staffUser.id, roleId: viewerRoleId, status: 'ACTIVE' },
    });

    const context: OrganizationContext = { id: organizationId } as OrganizationContext;
    await members.updateMember(
      context,
      ownerUser,
      member.id,
      { roleId: accountantRoleId },
      { ipHash: 'test-ip-hash', userAgent: null },
    );

    const auditRow = await harness.prisma.auditEvent.findFirst({
      where: { organizationId, entityId: member.id },
    });
    expect(auditRow).toMatchObject({
      eventKey: 'organization.member_updated',
      entityType: 'OrganizationMember',
      action: 'UPDATE',
      before: { roleKey: 'VIEWER', status: 'ACTIVE' },
      after: { roleKey: 'ACCOUNTANT', status: 'ACTIVE' },
    });

    // The pre-existing SecurityEvent write is untouched -- the two streams coexist.
    const securityRow = await harness.prisma.securityEvent.findFirst({
      where: { organizationId, eventKey: 'organization.member_updated' },
    });
    expect(securityRow).not.toBeNull();

    const page = await auditLogService.list(organizationId, {});

    expect(page.events.map((e) => e.source).sort()).toEqual(['audit', 'security']);
    const merged = page.events.find((e) => e.source === 'audit');
    expect(merged?.before).toEqual({ roleKey: 'VIEWER', status: 'ACTIVE' });
    expect(merged?.after).toEqual({ roleKey: 'ACCOUNTANT', status: 'ACTIVE' });
  });

  it('paginates the merged stream with a stable keyset cursor and no duplicates or gaps', async () => {
    // Interleave the two sources across distinct timestamps so a correct merge is actually exercised.
    for (let i = 0; i < 5; i++) {
      await harness.prisma.auditEvent.create({
        data: {
          organizationId,
          eventKey: `audit.item_${i}`,
          entityType: 'Thing',
          action: 'CREATE',
          occurredAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i * 2)),
        },
      });
      await harness.prisma.securityEvent.create({
        data: {
          organizationId,
          eventKey: `security.item_${i}`,
          occurredAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i * 2 + 1)),
        },
      });
    }

    const seen: string[] = [];
    let cursor: string | null | undefined;
    do {
      const page = await auditLogService.list(organizationId, {
        limit: 3,
        cursor: cursor ?? undefined,
      });
      seen.push(...page.events.map((e) => `${e.source}:${e.eventKey}`));
      cursor = page.nextCursor;
    } while (cursor);

    expect(seen.length).toBe(10);
    expect(new Set(seen).size).toBe(10);

    const allAtOnce = await auditLogService.list(organizationId, { limit: 100 });
    expect(allAtOnce.events.map((e) => `${e.source}:${e.eventKey}`)).toEqual(seen);
  });

  it('filters to a single source when requested', async () => {
    await harness.prisma.auditEvent.create({
      data: { organizationId, eventKey: 'audit.only', entityType: 'Thing', action: 'CREATE' },
    });
    await harness.prisma.securityEvent.create({
      data: { organizationId, eventKey: 'security.only' },
    });

    const auditOnly = await auditLogService.list(organizationId, { source: 'audit' });
    expect(auditOnly.events).toHaveLength(1);
    expect(auditOnly.events[0]?.source).toBe('audit');

    const securityOnly = await auditLogService.list(organizationId, { source: 'security' });
    expect(securityOnly.events).toHaveLength(1);
    expect(securityOnly.events[0]?.source).toBe('security');
  });

  it('never mutates an audit event once written, over the real database', async () => {
    const created = await harness.prisma.auditEvent.create({
      data: { organizationId, eventKey: 'audit.immutable', entityType: 'Thing', action: 'CREATE' },
    });

    // There is deliberately no update/delete path in AuditLogService or its controller; this proves
    // the row is stable across a read, not that Postgres enforces immutability structurally.
    const reread = await harness.prisma.auditEvent.findUniqueOrThrow({ where: { id: created.id } });
    expect(reread).toEqual(created);
  });

  it('exports the merged stream as CSV with before/after JSON columns', async () => {
    await harness.prisma.auditEvent.create({
      data: {
        organizationId,
        eventKey: 'audit.csv_case',
        entityType: 'Thing',
        entityId: 'thing-1',
        action: 'UPDATE',
        before: { name: 'Old' },
        after: { name: 'New' },
      },
    });

    const csv = await auditLogService.exportCsv(organizationId, {});
    const lines = csv.split('\r\n');

    expect(lines[0]).toBe(
      'occurred_at,source,event_key,action,entity_type,entity_id,actor_email,actor_name,before,after',
    );
    expect(lines[1]).toContain('audit.csv_case');
    expect(lines[1]).toContain('"{""name"":""Old""}"');
    expect(lines[1]).toContain('"{""name"":""New""}"');
  });
});
