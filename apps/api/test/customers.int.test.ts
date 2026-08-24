import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PublicUser } from '../src/auth/auth.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import type { OrganizationContext } from '../src/organizations/organization-context.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { CustomersService } from '../src/sales/customers.service.js';
import { createTestHarness, type TestHarness } from './support/app.js';

const metadata = {
  ipHash: 'customers-test',
  userAgent: 'RetailBooks integration test',
};

describe('customers against a real database', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let customers: CustomersService;
  let owner: PublicUser;
  let context: OrganizationContext;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
    customers = harness.app.get(CustomersService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    const user = await harness.prisma.user.create({
      data: {
        email: 'customers-owner@example.test',
        displayName: 'Customers Owner',
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
      { legalName: 'Customer Books Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    const draftContext = await access.requireMembership(owner.id, created.id);
    await organizations.finalize(draftContext, owner, metadata);
    context = await access.requireMembership(owner.id, created.id);
  });

  it('creates a customer defaulting to the organization base currency', async () => {
    const created = await customers.create(
      context,
      owner,
      { displayName: 'Acme Retail' },
      metadata,
    );
    expect(created.currency).toBe('KES');
    expect(created.status).toBe('ACTIVE');
  });

  it('rejects a second customer with the same display name in the same organization', async () => {
    await customers.create(context, owner, { displayName: 'Acme Retail' }, metadata);

    await expect(
      customers.create(context, owner, { displayName: 'Acme Retail' }, metadata),
    ).rejects.toThrow('A customer with this name already exists.');
  });

  it('lets a role with customers.currency_override set a non-base currency', async () => {
    const created = await customers.create(
      context,
      owner,
      { displayName: 'US Buyer', currency: 'USD' },
      metadata,
    );
    expect(created.currency).toBe('USD');
  });

  it('blocks a role without customers.currency_override from setting a non-base currency', async () => {
    const accountantContext = await createActorWithRole('ACCOUNTANT');

    await expect(
      customers.create(accountantContext, owner, { displayName: 'Base Currency Buyer' }, metadata),
    ).resolves.toMatchObject({ currency: 'KES' });

    await expect(
      customers.create(
        accountantContext,
        owner,
        { displayName: 'US Buyer', currency: 'USD' },
        metadata,
      ),
    ).rejects.toThrow(/currency-override permission/);
  });

  it('isolates customers by organization: a customer from another org is not found here', async () => {
    const created = await customers.create(
      context,
      owner,
      { displayName: 'Acme Retail' },
      metadata,
    );

    const otherUser = await harness.prisma.user.create({
      data: {
        email: 'other-owner@example.test',
        displayName: 'Other Owner',
        emailVerifiedAt: new Date(),
        status: 'ACTIVE',
      },
    });
    const otherOwner: PublicUser = {
      id: otherUser.id,
      email: otherUser.email,
      displayName: otherUser.displayName,
      emailVerified: true,
      status: otherUser.status,
    };
    const otherOrg = await organizations.create(
      otherOwner,
      { legalName: 'Other Tenant Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    const otherDraft = await access.requireMembership(otherOwner.id, otherOrg.id);
    await organizations.finalize(otherDraft, otherOwner, metadata);

    await expect(customers.detail(otherOrg.id, created.id)).rejects.toThrow('Customer not found.');
  });

  async function createActorWithRole(roleKey: 'ACCOUNTANT') {
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
