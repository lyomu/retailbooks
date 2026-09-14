import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import { diffFields } from '../organizations/audit-event.js';
import { loadApprovalTarget } from './approval-targets.js';

export interface ApprovalBriefing {
  readonly targetType: string;
  readonly targetId: string;
  readonly documentNumber: string | null;
  readonly amountMinor: string | null;
  readonly currency: string | null;
  readonly counterparty: string | null;
  readonly policyName: string;
  readonly policyConditions: string[];
  readonly changedSinceSubmission: readonly string[];
  readonly changedFieldDetail: {
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  } | null;
  readonly targetStillExists: boolean;
  readonly href: string;
}

const TARGET_HREF_BASE: Record<string, string> = {
  QUOTE: '/quotes',
  SALES_ORDER: '/sales-orders',
  INVOICE: '/invoices',
  CREDIT_NOTE: '/credit-notes',
  PURCHASE_ORDER: '/purchase-orders',
  BILL: '/bills',
  EXPENSE: '/expenses',
  VENDOR_CREDIT: '/vendor-credits',
  PAYMENT_MADE: '/payments-made',
};

/**
 * Deterministic approval briefing: no model call. `targetSnapshot` was frozen at submission time
 * (same shape `loadApprovalTarget` still returns for the live record), so comparing the two is a
 * real field-level diff, not a guess -- reusing the same `diffFields` helper audit events use.
 */
@Injectable()
export class ApprovalBriefingService {
  constructor(private readonly prisma: PrismaService) {}

  async brief(organizationId: string, requestId: string): Promise<ApprovalBriefing> {
    const request = await this.prisma.approvalRequest.findFirst({
      where: { id: requestId, organizationId },
      include: { policy: true },
    });
    if (!request) throw new NotFoundException('Approval request not found.');

    const current = await this.prisma.$transaction((tx) =>
      loadApprovalTarget(tx, organizationId, request.targetType, request.targetId),
    );
    const snapshot = (request.targetSnapshot ?? {}) as Record<string, unknown>;
    const currentSummary = (current?.summary ?? {}) as Record<string, unknown>;
    const fieldKeys = Object.keys(snapshot);
    const diff = current
      ? diffFields(snapshot, currentSummary, fieldKeys)
      : { changed: [] as string[], before: {}, after: {} };

    const documentNumber = pickString(currentSummary.documentNumber, snapshot.documentNumber);
    const amountMinor = pickString(currentSummary.totalMinor, snapshot.totalMinor);
    const currency = pickString(currentSummary.currency, snapshot.currency);
    const counterparty = pickString(
      currentSummary.contactName ?? currentSummary.vendorName,
      snapshot.contactName ?? snapshot.vendorName,
    );

    return {
      targetType: request.targetType,
      targetId: request.targetId,
      documentNumber,
      amountMinor,
      currency,
      counterparty,
      policyName: request.policy.name,
      policyConditions: describeConditions(
        request.policy.conditions as Record<string, unknown> | null,
      ),
      changedSinceSubmission: diff.changed,
      changedFieldDetail:
        diff.changed.length > 0 ? { before: diff.before, after: diff.after } : null,
      targetStillExists: current !== null,
      href: `${TARGET_HREF_BASE[request.targetType] ?? ''}/${request.targetId}`,
    };
  }
}

function pickString(current: unknown, fallback: unknown): string | null {
  if (typeof current === 'string') return current;
  if (typeof fallback === 'string') return fallback;
  return null;
}

function describeConditions(conditions: Record<string, unknown> | null): string[] {
  if (!conditions) return [];
  const parts: string[] = [];
  if (typeof conditions.minimumAmountMinor === 'string') {
    parts.push(`Amount at least ${conditions.minimumAmountMinor} minor units`);
  }
  if (typeof conditions.maximumAmountMinor === 'string') {
    parts.push(`Amount at most ${conditions.maximumAmountMinor} minor units`);
  }
  if (Array.isArray(conditions.submitterRoles) && conditions.submitterRoles.length > 0) {
    parts.push(`Submitter role in: ${conditions.submitterRoles.join(', ')}`);
  }
  if (Array.isArray(conditions.submitterUserIds) && conditions.submitterUserIds.length > 0) {
    parts.push('Restricted to specific submitters');
  }
  if (Array.isArray(conditions.tagIds) && conditions.tagIds.length > 0) {
    parts.push('Restricted to specific tags');
  }
  if (Array.isArray(conditions.projectIds) && conditions.projectIds.length > 0) {
    parts.push('Restricted to specific projects');
  }
  return parts;
}
