export interface AuditLogCursor {
  readonly occurredAt: string;
  readonly id: string;
}

/** Opaque, base64url-encoded `${occurredAtIso}|${id}` keyset cursor. */
export function encodeCursor(cursor: AuditLogCursor): string {
  return Buffer.from(`${cursor.occurredAt}|${cursor.id}`, 'utf8').toString('base64url');
}

export function decodeCursor(value: string): AuditLogCursor {
  const decoded = Buffer.from(value, 'base64url').toString('utf8');
  const separatorIndex = decoded.lastIndexOf('|');
  if (separatorIndex <= 0) throw new RangeError('Invalid audit-log cursor.');

  const occurredAt = decoded.slice(0, separatorIndex);
  const id = decoded.slice(separatorIndex + 1);
  if (!occurredAt || !id || Number.isNaN(Date.parse(occurredAt))) {
    throw new RangeError('Invalid audit-log cursor.');
  }
  return { occurredAt, id };
}
