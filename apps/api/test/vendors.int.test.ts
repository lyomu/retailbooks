import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PublicUser } from '../src/auth/auth.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import type { OrganizationContext } from '../src/organizations/organization-context.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { VendorsService } from '../src/purchases/vendors.service.js';
import { createTestHarness, type TestHarness } from './support/app.js';

const metadata = {
  ipHash: 'vendors-test',
  userAgent: 'RetailBooks integration test',
};

describe('vendors against a real database', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let vendors: VendorsService;
  let owner: PublicUser;
  let context: OrganizationContext;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
    vendors = harness.app.get(VendorsService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    const user = await harness.prisma.user.create({
      data: {
        email: 'vendors-owner@example.test',
        displayName: 'Vendors Owner',
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
      { legalName: 'Vendor Books Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    const draftContext = await access.requireMembership(owner.id, created.id);
    await organizations.finalize(draftContext, owner, metadata);
    context = await access.requireMembership(owner.id, created.id);
  });

  describe('CRUD', () => {
    it('creates a vendor defaulting to the organization base currency', async () => {
      const created = await vendors.create(
        context,
        owner,
        { displayName: 'Acme Supplies' },
        metadata,
      );
      expect(created.currency).toBe('KES');
      expect(created.status).toBe('ACTIVE');
    });

    it('fetches vendor detail', async () => {
      const created = await vendors.create(
        context,
        owner,
        { displayName: 'Acme Supplies' },
        metadata,
      );
      const detail = await vendors.detail(context.id, created.id);
      expect(detail.id).toBe(created.id);
      expect(detail.displayName).toBe('Acme Supplies');
    });

    it('updates a vendor', async () => {
      const created = await vendors.create(
        context,
        owner,
        { displayName: 'Acme Supplies' },
        metadata,
      );
      const updated = await vendors.update(
        context,
        owner,
        created.id,
        { legalName: 'Acme Supplies Ltd', paymentTermsDays: 30 },
        metadata,
      );
      expect(updated.legalName).toBe('Acme Supplies Ltd');
      expect(updated.paymentTermsDays).toBe(30);
    });

    it('lists vendors for the organization', async () => {
      await vendors.create(context, owner, { displayName: 'Acme Supplies' }, metadata);
      await vendors.create(context, owner, { displayName: 'Widget Co' }, metadata);

      const list = await vendors.list(context.id);
      expect(list.map((vendor) => vendor.displayName).sort()).toEqual([
        'Acme Supplies',
        'Widget Co',
      ]);
    });

    it('sets a vendor inactive and back to active via setStatus', async () => {
      const created = await vendors.create(
        context,
        owner,
        { displayName: 'Acme Supplies' },
        metadata,
      );

      const deactivated = await vendors.setStatus(context, owner, created.id, 'INACTIVE', metadata);
      expect(deactivated.status).toBe('INACTIVE');

      const reactivated = await vendors.setStatus(context, owner, created.id, 'ACTIVE', metadata);
      expect(reactivated.status).toBe('ACTIVE');
    });

    it('rejects editing a deactivated vendor', async () => {
      const created = await vendors.create(
        context,
        owner,
        { displayName: 'Acme Supplies' },
        metadata,
      );
      await vendors.setStatus(context, owner, created.id, 'INACTIVE', metadata);

      await expect(
        vendors.update(context, owner, created.id, { legalName: 'New Name' }, metadata),
      ).rejects.toThrow('Deactivated vendors cannot be edited.');
    });
  });

  describe('duplicate-vendor warning', () => {
    it('warns (does not silently allow) a case-insensitive display-name match on create', async () => {
      await vendors.create(context, owner, { displayName: 'Acme Supplies' }, metadata);

      await expect(
        vendors.create(context, owner, { displayName: 'ACME supplies' }, metadata),
      ).rejects.toThrow(
        /A vendor with a similar name or tax ID already exists \(Acme Supplies\)\. Resubmit with confirmDuplicate to create anyway\./,
      );

      // Confirmed a warning, not a hard uniqueness constraint: nothing was persisted differently.
      const list = await vendors.list(context.id);
      expect(list).toHaveLength(1);
    });

    it('warns on a tax-ID match even when the display name differs, on create', async () => {
      await vendors.create(
        context,
        owner,
        { displayName: 'Acme Supplies', taxIds: [{ label: 'PIN', value: 'P0001234X' }] },
        metadata,
      );

      await expect(
        vendors.create(
          context,
          owner,
          { displayName: 'Totally Different Co', taxIds: [{ label: 'PIN', value: 'P0001234X' }] },
          metadata,
        ),
      ).rejects.toThrow(
        /A vendor with a similar name or tax ID already exists \(Acme Supplies\)\./,
      );
    });

    it('lets confirmDuplicate bypass the warning and create the vendor anyway', async () => {
      await vendors.create(context, owner, { displayName: 'Acme Supplies' }, metadata);

      const second = await vendors.create(
        context,
        owner,
        { displayName: 'Acme Supplies', confirmDuplicate: true },
        metadata,
      );
      expect(second.displayName).toBe('Acme Supplies');

      const list = await vendors.list(context.id);
      expect(list).toHaveLength(2);
    });

    it('warns on a case-insensitive display-name match when renaming via update', async () => {
      await vendors.create(context, owner, { displayName: 'Acme Supplies' }, metadata);
      const other = await vendors.create(context, owner, { displayName: 'Other Vendor' }, metadata);

      await expect(
        vendors.update(context, owner, other.id, { displayName: 'acme supplies' }, metadata),
      ).rejects.toThrow(
        /A vendor with a similar name already exists \(Acme Supplies\)\. Resubmit with confirmDuplicate to rename anyway\./,
      );

      // The rejected rename must not have gone through.
      const unchanged = await vendors.detail(context.id, other.id);
      expect(unchanged.displayName).toBe('Other Vendor');
    });

    it('lets confirmDuplicate bypass the warning and rename anyway via update', async () => {
      await vendors.create(context, owner, { displayName: 'Acme Supplies' }, metadata);
      const other = await vendors.create(context, owner, { displayName: 'Other Vendor' }, metadata);

      const renamed = await vendors.update(
        context,
        owner,
        other.id,
        { displayName: 'Acme Supplies', confirmDuplicate: true },
        metadata,
      );
      expect(renamed.displayName).toBe('Acme Supplies');
    });

    it('does not warn when renaming to the same name only with different casing (no-op rename)', async () => {
      // update()'s guard only fires when the new name differs from the existing one; renaming
      // 'Acme Supplies' to itself (even with different casing) should not trip the duplicate check
      // against itself.
      const created = await vendors.create(
        context,
        owner,
        { displayName: 'Acme Supplies' },
        metadata,
      );

      const updated = await vendors.update(
        context,
        owner,
        created.id,
        { displayName: 'ACME SUPPLIES' },
        metadata,
      );
      expect(updated.displayName).toBe('ACME SUPPLIES');
    });

    it('surfaces the same case-insensitive match through checkDuplicate', async () => {
      await vendors.create(context, owner, { displayName: 'Acme Supplies' }, metadata);

      const matches = await vendors.checkDuplicate(context.id, 'acme SUPPLIES');
      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject({ displayName: 'Acme Supplies', matchedOn: 'displayName' });
    });
  });

  describe('currency handling', () => {
    it('lets a role with vendors.currency_override set a non-base currency', async () => {
      const created = await vendors.create(
        context,
        owner,
        { displayName: 'US Supplier', currency: 'USD' },
        metadata,
      );
      expect(created.currency).toBe('USD');
    });

    it('blocks a role without vendors.currency_override from setting a non-base currency', async () => {
      const salesContext = await createActorWithRole('SALES');

      await expect(
        vendors.create(salesContext, owner, { displayName: 'Base Currency Supplier' }, metadata),
      ).resolves.toMatchObject({ currency: 'KES' });

      await expect(
        vendors.create(
          salesContext,
          owner,
          { displayName: 'US Supplier', currency: 'USD' },
          metadata,
        ),
      ).rejects.toThrow(/currency-override permission/);
    });

    it('blocks changing an existing vendor to a non-base currency without the override permission', async () => {
      const created = await vendors.create(
        context,
        owner,
        { displayName: 'Acme Supplies' },
        metadata,
      );
      const salesContext = await createActorWithRole('SALES');

      await expect(
        vendors.update(salesContext, owner, created.id, { currency: 'USD' }, metadata),
      ).rejects.toThrow(/currency-override permission/);
    });
  });

  async function createActorWithRole(roleKey: 'SALES') {
    const role = await harness.prisma.role.findFirstOrThrow({
      where: { organizationId: context.id, key: roleKey },
    });
    const actorUser = await harness.prisma.user.create({
      data: {
        email: `${roleKey.toLowerCase()}@example.test`,
        displayName: roleKey,
        emailVerifiedAt: new Date(),
        status: 'ACTIVE',
      },
    });
    await harness.prisma.organizationMember.create({
      data: { organizationId: context.id, userId: actorUser.id, roleId: role.id, status: 'ACTIVE' },
    });
    return access.requireMembership(actorUser.id, context.id);
  }
});
