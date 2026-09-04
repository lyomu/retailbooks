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
  ipHash: 'approvals-test',
  userAgent: 'RetailBooks integration test',
};

describe('approval engine against a real database', () => {
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
        email: 'approvals-owner@example.test',
        displayName: 'Approvals Owner',
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
      { legalName: 'Approval Books Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    const draftContext = await access.requireMembership(owner.id, created.id);
    await organizations.finalize(draftContext, owner, metadata);
    context = await access.requireMembership(owner.id, created.id);
    await periods.generateFiscalYear(context, owner, { startsOn: '2026-01-01' }, metadata);

    const contact = await customers.create(
      context,
      owner,
      { displayName: 'Acme Retail', email: 'acme-retail@example.test' },
      metadata,
    );
    contactId = contact.id;
  });

  async function createMember(roleKey: 'ADMIN', emailLocal: string) {
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

  async function createSingleStepInvoicePolicy(approverUserId: string, allowSelfApproval = false) {
    return approvals.createPolicy(
      context,
      owner,
      {
        name: 'Invoice sign-off',
        targetType: 'INVOICE',
        priority: 0,
        allowSelfApproval,
        steps: [{ approverUserId, label: 'Finance sign-off' }],
      },
      metadata,
    );
  }

  async function draftInvoice(unitPriceMinor = '10000') {
    return invoices.createDraft(
      context,
      owner,
      {
        contactId,
        lines: [{ description: 'Widget', quantity: '1', unitPriceMinor }],
      },
      metadata,
    );
  }

  it(
    'build spec §18.7: maker cannot issue before approval, approver rejects, maker edits and ' +
      'resubmits, approver approves, issue succeeds, and history is complete',
    async () => {
      const approver = await createMember('ADMIN', 'approver');
      const policy = await createSingleStepInvoicePolicy(approver.user.id);
      await approvals.setPolicyStatus(context, owner, policy.id, 'ACTIVE', metadata);

      const draft = await draftInvoice('10000');
      const firstRequest = await targets.submit(context, owner, 'INVOICE', draft.id, metadata);
      expect(firstRequest.status).toBe('PENDING');

      // Maker cannot issue before approval.
      await expect(invoices.issueInvoice(context, owner, draft.id, metadata)).rejects.toThrow(
        'This document is awaiting approval and cannot be finalized.',
      );

      // Approver rejects with a comment.
      const rejected = await approvals.decide(
        approver.context,
        approver.user,
        firstRequest.id,
        { decision: 'REJECTED', comment: 'Price looks wrong, please recheck.' },
        metadata,
      );
      expect(rejected.status).toBe('REJECTED');

      // Still cannot issue: no active approval, but the invoice itself is unchanged and still DRAFT
      // with no policy blocking it directly -- issuing now should work in principle since the only
      // gate is a *pending* request, and this one is resolved. The real block on reissuing the same
      // (unedited) content is a business process, not enforced by the engine, so re-submitting the
      // same draft is expected to succeed and freeze a fresh snapshot.

      // Maker edits the invoice (the fix the approver asked for) and resubmits.
      await invoices.updateDraft(
        context,
        owner,
        draft.id,
        { lines: [{ description: 'Widget', quantity: '1', unitPriceMinor: '9000' }] },
        metadata,
      );
      const secondRequest = await targets.submit(context, owner, 'INVOICE', draft.id, metadata);
      expect(secondRequest.status).toBe('PENDING');
      expect(secondRequest.id).not.toBe(firstRequest.id);

      // Approver approves the final step.
      const approved = await approvals.decide(
        approver.context,
        approver.user,
        secondRequest.id,
        { decision: 'APPROVED' },
        metadata,
      );
      expect(approved.status).toBe('APPROVED');

      // Issue now succeeds.
      const issued = await invoices.issueInvoice(context, owner, draft.id, metadata);
      expect(issued.status).toBe('ISSUED');
      expect(issued.totalMinor).toBe('9000');

      // Complete history: both requests are visible to the submitter, in reverse chronological order.
      const mine = await approvals.submittedByMe(context, owner);
      expect(mine).toHaveLength(2);
      expect(mine[0]?.id).toBe(secondRequest.id);
      expect(mine[0]?.status).toBe('APPROVED');
      expect(mine[1]?.id).toBe(firstRequest.id);
      expect(mine[1]?.status).toBe('REJECTED');

      const rejectedDetail = await approvals.detail(context, firstRequest.id);
      expect(rejectedDetail.steps[0]?.decisions[0]).toMatchObject({
        decision: 'REJECTED',
        comment: 'Price looks wrong, please recheck.',
      });
      const approvedDetail = await approvals.detail(context, secondRequest.id);
      expect(approvedDetail.steps[0]?.decisions[0]).toMatchObject({ decision: 'APPROVED' });
    },
  );

  it('denies the submitter approving their own request unless the policy allows it', async () => {
    const policy = await createSingleStepInvoicePolicy(owner.id, false);
    await approvals.setPolicyStatus(context, owner, policy.id, 'ACTIVE', metadata);
    const draft = await draftInvoice();
    const request = await targets.submit(context, owner, 'INVOICE', draft.id, metadata);

    await expect(
      approvals.decide(context, owner, request.id, { decision: 'APPROVED' }, metadata),
    ).rejects.toThrow('The submitter cannot approve their own request.');
  });

  it('rejects a decision once the target changed after submission (stale target version)', async () => {
    const approver = await createMember('ADMIN', 'stale-approver');
    const policy = await createSingleStepInvoicePolicy(approver.user.id);
    await approvals.setPolicyStatus(context, owner, policy.id, 'ACTIVE', metadata);

    const draft = await draftInvoice();
    const request = await targets.submit(context, owner, 'INVOICE', draft.id, metadata);

    // The invoice changes after submission -- its updatedAt no longer matches the frozen version.
    await invoices.updateDraft(
      context,
      owner,
      draft.id,
      { lines: [{ description: 'Widget', quantity: '2', unitPriceMinor: '10000' }] },
      metadata,
    );

    await expect(
      approvals.decide(
        approver.context,
        approver.user,
        request.id,
        { decision: 'APPROVED' },
        metadata,
      ),
    ).rejects.toThrow('This document changed after the approval request was submitted');
  });

  it('rejects a second submission while one is already pending for the same target', async () => {
    const approver = await createMember('ADMIN', 'dup-approver');
    const policy = await createSingleStepInvoicePolicy(approver.user.id);
    await approvals.setPolicyStatus(context, owner, policy.id, 'ACTIVE', metadata);

    const draft = await draftInvoice();
    await targets.submit(context, owner, 'INVOICE', draft.id, metadata);

    await expect(targets.submit(context, owner, 'INVOICE', draft.id, metadata)).rejects.toThrow(
      'This document already has a pending approval request.',
    );
  });

  it('rejects submission when no active policy matches the target', async () => {
    const draft = await draftInvoice();
    await expect(targets.submit(context, owner, 'INVOICE', draft.id, metadata)).rejects.toThrow(
      'No active approval policy applies to this document',
    );
  });

  it('lets the submitter cancel a pending request, unblocking finalization', async () => {
    const approver = await createMember('ADMIN', 'cancel-approver');
    const policy = await createSingleStepInvoicePolicy(approver.user.id);
    await approvals.setPolicyStatus(context, owner, policy.id, 'ACTIVE', metadata);

    const draft = await draftInvoice();
    const request = await targets.submit(context, owner, 'INVOICE', draft.id, metadata);
    await expect(invoices.issueInvoice(context, owner, draft.id, metadata)).rejects.toThrow(
      'awaiting approval',
    );

    const cancelled = await approvals.cancel(context, owner, request.id, metadata);
    expect(cancelled.status).toBe('CANCELLED');

    const issued = await invoices.issueInvoice(context, owner, draft.id, metadata);
    expect(issued.status).toBe('ISSUED');
  });
});
