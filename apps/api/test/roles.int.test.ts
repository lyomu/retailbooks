import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PublicUser } from '../src/auth/auth.service.js';
import type { OrganizationContext } from '../src/organizations/organization-context.js';
import { OrganizationMembersService } from '../src/organizations/organization-members.service.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { SYSTEM_ROLE_KEYS } from '../src/organizations/roles-catalog.js';
import { RolesService } from '../src/organizations/roles.service.js';
import { createTestHarness, type TestHarness } from './support/app.js';

const metadata = { ipHash: 'test-ip-hash', userAgent: null };

describe('roles and permissions against a real database', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let members: OrganizationMembersService;
  let roles: RolesService;
  let owner: PublicUser;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    members = harness.app.get(OrganizationMembersService);
    roles = harness.app.get(RolesService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    const user = await harness.prisma.user.create({
      data: {
        email: 'owner@example.com',
        displayName: 'Owner',
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
  });

  async function createOrganization() {
    return organizations.create(
      owner,
      { legalName: 'Demo Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
  }

  it('seeds exactly the eight system roles as part of organization creation, in the same transaction as the owner membership', async () => {
    const organization = await createOrganization();

    const seededRoles = await harness.prisma.role.findMany({
      where: { organizationId: organization.id },
      select: { key: true, isSystem: true, isOwnerRole: true },
    });
    expect(seededRoles.map((r) => r.key).sort()).toEqual([...SYSTEM_ROLE_KEYS].sort());
    expect(seededRoles.every((r) => r.isSystem)).toBe(true);
    expect(seededRoles.filter((r) => r.isOwnerRole)).toHaveLength(1);

    const member = await harness.prisma.organizationMember.findFirst({
      where: { organizationId: organization.id, userId: owner.id },
      include: { role: true },
    });
    expect(member?.role.key).toBe('OWNER');
    expect(member?.role.isOwnerRole).toBe(true);
  });

  it('seeds the owner role with the complete permission catalog, not the (empty) template list', async () => {
    const organization = await createOrganization();

    const ownerRole = await harness.prisma.role.findFirstOrThrow({
      where: { organizationId: organization.id, isOwnerRole: true },
      include: { permissions: true },
    });
    const catalog = await roles.listRoles(organization.id);
    expect(ownerRole.permissions.map((p) => p.permissionKey).sort()).toEqual(
      catalog.catalog.map((p) => p.key).sort(),
    );
  });

  it('scopes roles per organization: two organizations never share a role row', async () => {
    const first = await createOrganization();

    const secondUser = await harness.prisma.user.create({
      data: {
        email: 'second-owner@example.com',
        displayName: 'Second Owner',
        emailVerifiedAt: new Date(),
        status: 'ACTIVE',
      },
    });
    const second = await organizations.create(
      {
        id: secondUser.id,
        email: secondUser.email,
        displayName: secondUser.displayName,
        emailVerified: true,
        status: secondUser.status,
      },
      { legalName: 'Second Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );

    const firstAdmin = await harness.prisma.role.findFirstOrThrow({
      where: { organizationId: first.id, key: 'ADMIN' },
    });
    const secondAdmin = await harness.prisma.role.findFirstOrThrow({
      where: { organizationId: second.id, key: 'ADMIN' },
    });
    expect(firstAdmin.id).not.toBe(secondAdmin.id);

    // Editing one organization's Administrator role must never touch the other's.
    await roles.updateRole(first.id, firstAdmin.id, owner, { permissions: [] }, metadata);
    const secondAdminAfter = await harness.prisma.role.findUniqueOrThrow({
      where: { id: secondAdmin.id },
      include: { permissions: true },
    });
    expect(secondAdminAfter.permissions.length).toBeGreaterThan(0);
  });

  it('never allows a protected key to be granted through updateRole, even to a system role', async () => {
    const organization = await createOrganization();
    const admin = await harness.prisma.role.findFirstOrThrow({
      where: { organizationId: organization.id, key: 'ADMIN' },
    });

    await expect(
      roles.updateRole(
        organization.id,
        admin.id,
        owner,
        { permissions: ['roles.manage'] },
        metadata,
      ),
    ).rejects.toThrow();
  });

  it("rejects any change to the owner role's permissions", async () => {
    const organization = await createOrganization();
    const ownerRole = await harness.prisma.role.findFirstOrThrow({
      where: { organizationId: organization.id, isOwnerRole: true },
    });

    await expect(
      roles.updateRole(organization.id, ownerRole.id, owner, { permissions: [] }, metadata),
    ).rejects.toThrow();
  });

  it('rejects assigning the owner role to a member through resolveAssignableRole', async () => {
    const organization = await createOrganization();
    const ownerRole = await harness.prisma.role.findFirstOrThrow({
      where: { organizationId: organization.id, isOwnerRole: true },
    });

    await expect(roles.resolveAssignableRole(organization.id, ownerRole.id)).rejects.toThrow();
  });

  it('creates a custom role, generates a unique key, and rejects a protected permission at creation time', async () => {
    const organization = await createOrganization();

    const created = await roles.createRole(
      organization.id,
      owner,
      { name: 'Regional Manager', permissions: ['organization.view', 'reports.view'] },
      metadata,
    );
    expect(created.isSystem).toBe(false);
    expect(created.key).toBe('REGIONAL_MANAGER');
    expect(created.permissions.sort()).toEqual(['organization.view', 'reports.view']);

    await expect(
      roles.createRole(
        organization.id,
        owner,
        { name: 'Escalator', permissions: ['roles.manage'] },
        metadata,
      ),
    ).rejects.toThrow();
  });

  it('deduplicates a colliding role key rather than failing', async () => {
    const organization = await createOrganization();

    const first = await roles.createRole(
      organization.id,
      owner,
      { name: 'Regional Manager', permissions: [] },
      metadata,
    );
    const second = await roles.createRole(
      organization.id,
      owner,
      { name: 'Regional Manager', permissions: [] },
      metadata,
    );
    expect(first.key).not.toBe(second.key);
  });

  it('refuses to delete a custom role while a member holds it, and succeeds once reassigned', async () => {
    const organization = await createOrganization();
    const custom = await roles.createRole(
      organization.id,
      owner,
      { name: 'Temp Role', permissions: [] },
      metadata,
    );
    const accountant = await harness.prisma.role.findFirstOrThrow({
      where: { organizationId: organization.id, key: 'ACCOUNTANT' },
    });

    const staffUser = await harness.prisma.user.create({
      data: { email: 'staff@example.com', displayName: 'Staff', emailVerifiedAt: new Date() },
    });
    const member = await harness.prisma.organizationMember.create({
      data: {
        organizationId: organization.id,
        userId: staffUser.id,
        roleId: custom.id,
        status: 'ACTIVE',
      },
    });

    await expect(roles.deleteRole(organization.id, custom.id, owner, metadata)).rejects.toThrow();

    const context: OrganizationContext = { id: organization.id } as OrganizationContext;
    await members.updateMember(context, owner, member.id, { roleId: accountant.id }, metadata);

    await expect(
      roles.deleteRole(organization.id, custom.id, owner, metadata),
    ).resolves.not.toThrow();
    expect(await harness.prisma.role.findUnique({ where: { id: custom.id } })).toBeNull();
  });

  it('refuses to delete a system role', async () => {
    const organization = await createOrganization();
    const accountant = await harness.prisma.role.findFirstOrThrow({
      where: { organizationId: organization.id, key: 'ACCOUNTANT' },
    });

    await expect(
      roles.deleteRole(organization.id, accountant.id, owner, metadata),
    ).rejects.toThrow();
  });

  it('refuses to rename a system role but allows changing its permissions', async () => {
    const organization = await createOrganization();
    const accountant = await harness.prisma.role.findFirstOrThrow({
      where: { organizationId: organization.id, key: 'ACCOUNTANT' },
    });

    await expect(
      roles.updateRole(organization.id, accountant.id, owner, { name: 'Renamed' }, metadata),
    ).rejects.toThrow();

    const updated = await roles.updateRole(
      organization.id,
      accountant.id,
      owner,
      { permissions: ['organization.view'] },
      metadata,
    );
    expect(updated.permissions).toEqual(['organization.view']);
    expect(updated.name).toBe('Accountant');
  });

  it('keeps the final owner unremovable and unreassignable through the real member service', async () => {
    const organization = await createOrganization();
    const ownerMember = await harness.prisma.organizationMember.findFirstOrThrow({
      where: { organizationId: organization.id, userId: owner.id },
    });
    const accountant = await harness.prisma.role.findFirstOrThrow({
      where: { organizationId: organization.id, key: 'ACCOUNTANT' },
    });
    const context: OrganizationContext = { id: organization.id } as OrganizationContext;

    await expect(
      members.updateMember(context, owner, ownerMember.id, { roleId: accountant.id }, metadata),
    ).rejects.toThrow();
    await expect(members.removeMember(context, owner, ownerMember.id, metadata)).rejects.toThrow();
  });

  it('writes an audit event with before/after permission sets when a role is updated', async () => {
    const organization = await createOrganization();
    const accountant = await harness.prisma.role.findFirstOrThrow({
      where: { organizationId: organization.id, key: 'ACCOUNTANT' },
    });

    await roles.updateRole(
      organization.id,
      accountant.id,
      owner,
      { permissions: ['organization.view', 'journals.view'] },
      metadata,
    );

    const auditRow = await harness.prisma.auditEvent.findFirst({
      where: {
        organizationId: organization.id,
        entityId: accountant.id,
        eventKey: 'organization.role_updated',
      },
    });
    expect(auditRow).not.toBeNull();
    expect((auditRow?.after as { permissions: string[] } | null)?.permissions.sort()).toEqual([
      'journals.view',
      'organization.view',
    ]);
  });
});
