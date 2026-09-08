import type { Prisma } from '@prisma/client';

import type { PlatformContext } from './platform-context.js';

export interface PlatformAuditInput {
  readonly eventKey: string;
  readonly targetType: string;
  readonly targetId?: string | null;
  /** Set when the action concerns exactly one tenant; null for global reference-data changes. */
  readonly organizationId?: string | null;
  readonly reason?: string | null;
  readonly before?: Prisma.InputJsonValue | null;
  readonly after?: Prisma.InputJsonValue | null;
  readonly ipHash?: string | null;
}

/**
 * Writes a platform-administration audit row inside the caller's transaction, so the record commits
 * with the change it describes and can never drift from it — the same rule tenant `writeAuditEvent`
 * follows.
 *
 * This log is separate from tenant `AuditEvent` on purpose. Most platform actions are cross-tenant,
 * so they have no organization to belong to; and the ones that do concern a single tenant must not
 * appear in that tenant's own audit trail as though the tenant performed them. A customer reading
 * their audit log should not find entries they did not make and cannot explain.
 */
export async function writePlatformAudit(
  tx: Prisma.TransactionClient,
  actor: PlatformContext,
  input: PlatformAuditInput,
) {
  return tx.platformAuditEvent.create({
    data: {
      platformAdminId: actor.id,
      actorUserId: actor.userId,
      eventKey: input.eventKey,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      organizationId: input.organizationId ?? null,
      reason: input.reason ?? null,
      before: input.before ?? undefined,
      after: input.after ?? undefined,
      ipHash: input.ipHash ?? null,
    },
  });
}
