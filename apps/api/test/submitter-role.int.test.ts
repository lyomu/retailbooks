import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PublicUser } from '../src/auth/auth.service.js';
import { ApprovalTargetsService } from '../src/automation/approval-targets.service.js';
import { ApprovalsService } from '../src/automation/approvals.service.js';
import { FiscalPeriodsService } from '../src/organizations/fiscal-periods.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import type { OrganizationContext } from '../src/organizations/organization-context.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { CustomersService } from '../src/sales/customers.service.js';
import { InvoicesService } from '../src/sales/invoices.service.js';
import { createTestHarness, type TestHarness } from './support/app.js';

const metadata = {
  ipHash: 'submitter-role-test',
  userAgent: 'RetailBooks integration test',
};

describe('submitter role approval condition (GAP #20)', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let periods: FiscalPeriodsService;
  let customers: CustomersService;
  let invoices: InvoicesService;
  let approvals: ApprovalsService;
  let targets: ApprovalTargetsService;
  let owner: PublicUser;
  let context: OrganizationContext;
  let contactId: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
    periods = harness.app.get(FiscalPeriodsService);
    customers = harness.app.get(CustomersService);
    invoices = harness.app.get(InvoicesService);
    approvals = harness.app.get(ApprovalsService);
    targets = harness.app.get(ApprovalTargetsService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    const user = await harness.prisma.user.create({
      data: {
        email: 'role-owner@example.test',
        displayName: 'Role Owner',
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
      { legalName: 'Role Books Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    const draftContext = await access.requireMembership(owner.id, created.id);
    await organizations.finalize(draftContext, owner, metadata);
    context = await access.requireMembership(owner.id, created.id);
    await periods.generateFiscalYear(context, owner, { startsOn: '2026-01-01' }, metadata);

    const contact = await customers.create(
      context,
      owner,
      { displayName: 'Role Customer', email: 'role-customer@example.test' },
      metadata,
    );
    contactId = contact.id;
  });

  async function createMember(roleKey: 'ADMIN' | 'SALES' | 'ACCOUNTANT', emailLocal: string) {
    const role = await harness.prisma.role.findFirstOrThrow({
      where: { organizationId: context.id, key: roleKey },
    });
    const actorUser = await harness.prisma.user.create({
      data: {
        email: `${emailLocal}@example.test`,
        displayName: emailLocal,
        emailVerifiedAt: new Date(),
        status: 'ACTIVE',
      },
    });
    await harness.prisma.organizationMember.create({
      data: { organizationId: context.id, userId: actorUser.id, roleId: role.id, status: 'ACTIVE' },
    });
    const memberContext = await access.requireMembership(actorUser.id, context.id);
    const publicUser: PublicUser = {
      id: actorUser.id,
      email: actorUser.email,
      displayName: actorUser.displayName,
      emailVerified: true,
      status: actorUser.status,
    };
    return { user: publicUser, context: memberContext };
  }

  async function createPolicyWithRoles(approverUserId: string, roles: string[]) {
    return approvals.createPolicy(
      context,
      owner,
      {
        name: 'Role-gated approval',
        targetType: 'INVOICE',
        priority: 0,
        conditions: { submitterRoles: roles },
        steps: [{ approverUserId, label: 'Finance sign-off' }],
      },
      metadata,
    );
  }

  async function draftInvoice() {
    return invoices.createDraft(
      context,
      owner,
      { contactId, lines: [{ description: 'Widget', quantity: '1', unitPriceMinor: '10000' }] },
      metadata,
    );
  }

  it('matches a policy when the submitter role is in the allowed list', async () => {
    const approver = await createMember('ADMIN', 'role-approver');
    const adminSubmitter = await createMember('ADMIN', 'admin-submitter');
    const policy = await createPolicyWithRoles(approver.user.id, ['ADMIN', 'ACCOUNTANT']);
    await approvals.setPolicyStatus(context, owner, policy.id, 'ACTIVE', metadata);

    const draft = await draftInvoice();
    const request = await targets.submit(
      adminSubmitter.context,
      adminSubmitter.user,
      'INVOICE',
      draft.id,
      metadata,
    );
    expect(request.status).toBe('PENDING');
  });

  it('does not match a policy when the submitter role is not in the allowed list', async () => {
    const approver = await createMember('ADMIN', 'role-approver-2');
    const salesSubmitter = await createMember('SALES', 'sales-submitter');
    const policy = await createPolicyWithRoles(approver.user.id, ['ADMIN', 'ACCOUNTANT']);
    await approvals.setPolicyStatus(context, owner, policy.id, 'ACTIVE', metadata);

    const draft = await draftInvoice();
    await expect(
      targets.submit(salesSubmitter.context, salesSubmitter.user, 'INVOICE', draft.id, metadata),
    ).rejects.toThrow('No active approval policy applies to this document');
  });

  it('matches any role when no submitterRoles condition is set', async () => {
    const approver = await createMember('ADMIN', 'role-approver-3');
    const salesSubmitter = await createMember('SALES', 'sales-submitter-open');
    const policy = await approvals.createPolicy(
      context,
      owner,
      {
        name: 'Open approval',
        targetType: 'INVOICE',
        priority: 0,
        steps: [{ approverUserId: approver.user.id, label: 'Any role' }],
      },
      metadata,
    );
    await approvals.setPolicyStatus(context, owner, policy.id, 'ACTIVE', metadata);

    const draft = await draftInvoice();
    const request = await targets.submit(
      salesSubmitter.context,
      salesSubmitter.user,
      'INVOICE',
      draft.id,
      metadata,
    );
    expect(request.status).toBe('PENDING');
  });

  it('combines submitterRoles with amount conditions', async () => {
    const approver = await createMember('ADMIN', 'role-approver-4');
    const accountantSubmitter = await createMember('ACCOUNTANT', 'acct-submitter');
    const policy = await approvals.createPolicy(
      context,
      owner,
      {
        name: 'ACCOUNTANT high-value',
        targetType: 'INVOICE',
        priority: 0,
        conditions: { submitterRoles: ['ACCOUNTANT'], minimumAmountMinor: '5000' },
        steps: [{ approverUserId: approver.user.id, label: 'High-value' }],
      },
      metadata,
    );
    await approvals.setPolicyStatus(context, owner, policy.id, 'ACTIVE', metadata);

    const draft = await draftInvoice();
    const request = await targets.submit(
      accountantSubmitter.context,
      accountantSubmitter.user,
      'INVOICE',
      draft.id,
      metadata,
    );
    expect(request.status).toBe('PENDING');
  });
});
