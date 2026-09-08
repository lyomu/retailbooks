import type { ActivityKind, AuditAction, CollaborationTargetType, Prisma } from '@prisma/client';

export interface AuditEventInput {
  readonly organizationId: string;
  readonly actorUserId: string | null;
  /** Dot-namespaced key, matching the SecurityEvent convention, e.g. `ledger.account_updated`. */
  readonly eventKey: string;
  readonly entityType: string;
  readonly entityId?: string | null;
  readonly action: AuditAction;
  readonly before?: Prisma.InputJsonValue | null;
  readonly after?: Prisma.InputJsonValue | null;
  readonly metadata?: Prisma.InputJsonObject;
  readonly ipHash?: string | null;
  /**
   * Set only by portal-originated writes. A customer performed the action, so the projected
   * activity row is customer-visible and attributed to the portal grant. Internal callers leave
   * this unset and keep the default `INTERNAL` projection.
   */
  readonly portalUserId?: string | null;
}

/**
 * Writes an audit row inside the caller's transaction, so the record commits with the mutation it
 * describes and can never drift from it.
 *
 * Mirrors the in-transaction `event(tx, ...)` helpers already used for SecurityEvent.
 */
export async function writeAuditEvent(tx: Prisma.TransactionClient, input: AuditEventInput) {
  // Activity is a read projection of audit history, never the authoritative audit log. Where an
  // event represents a recognised collaboration target, it is written in the same transaction and
  // bound uniquely to its source audit event. Comments and files own richer activity rows of their
  // own, so they are intentionally excluded from this generic projection.
  //
  // The projection is nested inside the audit insert rather than issued as a second call. Every
  // posting path in the application funnels through here, often many times per transaction, and a
  // second round trip per event was enough to push long postings -- a multi-line inventory
  // adjustment, for instance -- past Prisma's interactive-transaction deadline. Nesting also means
  // `occurredAt` is one value shared by both rows rather than two clocks that can disagree.
  const targetType = toCollaborationTarget(input.entityType);
  const projected =
    targetType &&
    input.entityId &&
    !input.eventKey.startsWith('attachments.') &&
    !input.eventKey.startsWith('collaboration.comment_');
  const occurredAt = new Date();

  return tx.auditEvent.create({
    data: {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      eventKey: input.eventKey,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      action: input.action,
      before: input.before ?? undefined,
      after: input.after ?? undefined,
      metadata: input.metadata ?? {},
      ipHash: input.ipHash ?? null,
      occurredAt,
      ...(projected && targetType && input.entityId
        ? {
            activity: {
              create: {
                organizationId: input.organizationId,
                targetType,
                targetId: input.entityId,
                kind: activityKind(input.eventKey),
                visibility: input.portalUserId ? 'CUSTOMER' : 'INTERNAL',
                eventKey: input.eventKey,
                metadata: input.metadata ?? {},
                actorUserId: input.actorUserId,
                portalUserId: input.portalUserId ?? null,
                occurredAt,
              },
            },
          }
        : {}),
    },
  });
}

const COLLABORATION_TARGETS: Record<string, CollaborationTargetType> = {
  quote: 'QUOTE',
  sales_order: 'SALES_ORDER',
  invoice: 'INVOICE',
  credit_note: 'CREDIT_NOTE',
  payment_received: 'PAYMENT_RECEIVED',
  purchase_order: 'PURCHASE_ORDER',
  bill: 'BILL',
  expense: 'EXPENSE',
  vendor_credit: 'VENDOR_CREDIT',
  payment_made: 'PAYMENT_MADE',
  journal: 'JOURNAL',
  opening_balance_batch: 'OPENING_BALANCE_BATCH',
  bank_transaction: 'BANK_TRANSACTION',
  transfer: 'TRANSFER',
  reconciliation: 'RECONCILIATION',
  inventory_adjustment: 'INVENTORY_ADJUSTMENT',
  stock_movement: 'STOCK_MOVEMENT',
  project: 'PROJECT',
  time_entry: 'TIME_ENTRY',
};

function toCollaborationTarget(entityType: string): CollaborationTargetType | undefined {
  return COLLABORATION_TARGETS[entityType];
}

function activityKind(eventKey: string): ActivityKind {
  if (eventKey.includes('approval')) return 'APPROVAL';
  if (eventKey.includes('sent') || eventKey.includes('email')) return 'EMAIL';
  if (eventKey.includes('posted') || eventKey.includes('issued') || eventKey.includes('allocated'))
    return 'ACCOUNTING';
  if (eventKey.includes('created') || eventKey.includes('updated')) return 'USER_ACTION';
  return 'STATUS';
}

export interface FieldDiff {
  readonly before: Record<string, unknown>;
  readonly after: Record<string, unknown>;
  readonly changed: readonly string[];
}

/**
 * Reduces a before/after pair to only the fields that actually differ.
 *
 * Audit rows are unbounded and append-only, so storing a whole entity snapshot on every edit is both
 * noisy to read and expensive to keep. Only `fields` are considered, which keeps derived and
 * sensitive columns out of the record by construction rather than by remembering to strip them.
 */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: T,
  fields: readonly (keyof T & string)[],
): FieldDiff {
  const beforeChanged: Record<string, unknown> = {};
  const afterChanged: Record<string, unknown> = {};
  const changed: string[] = [];

  for (const field of fields) {
    if (normalize(before[field]) === normalize(after[field])) continue;
    beforeChanged[field] = before[field] ?? null;
    afterChanged[field] = after[field] ?? null;
    changed.push(field);
  }

  return { before: beforeChanged, after: afterChanged, changed };
}

/** Compares by value so Date, Decimal, and BigInt columns do not read as changed on every write. */
function normalize(value: unknown): string {
  if (value === null || value === undefined) return 'nullish';
  if (value instanceof Date) return `date:${value.toISOString()}`;
  switch (typeof value) {
    case 'bigint':
      return `bigint:${value.toString()}`;
    case 'object':
      return `json:${JSON.stringify(value)}`;
    case 'string':
      return `string:${value}`;
    case 'number':
      return `number:${value}`;
    case 'boolean':
      return `boolean:${value}`;
    default:
      // symbol, function: not expected on an entity field, but stay comparable rather than throw.
      return `other:${Object.prototype.toString.call(value)}`;
  }
}
