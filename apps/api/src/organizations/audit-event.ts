import type { AuditAction, Prisma } from '@prisma/client';

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
}

/**
 * Writes an audit row inside the caller's transaction, so the record commits with the mutation it
 * describes and can never drift from it.
 *
 * Mirrors the in-transaction `event(tx, ...)` helpers already used for SecurityEvent.
 */
export function writeAuditEvent(tx: Prisma.TransactionClient, input: AuditEventInput) {
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
    },
  });
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
