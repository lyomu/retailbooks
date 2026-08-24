import { describe, expect, it } from 'vitest';

import { decodeCursor, encodeCursor } from '../src/organizations/audit-log-cursor';

describe('audit-log cursor', () => {
  it('round-trips an occurredAt/id pair', () => {
    const cursor = { occurredAt: '2026-08-17T12:34:56.789Z', id: 'a1b2c3' };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it('produces an opaque, non-guessable-looking string', () => {
    const encoded = encodeCursor({ occurredAt: '2026-08-17T00:00:00.000Z', id: 'x' });
    expect(encoded).not.toContain('|');
    expect(encoded).not.toContain('2026-08-17');
  });

  it('rejects a cursor with no separator', () => {
    expect(() => decodeCursor(Buffer.from('not-a-cursor').toString('base64url'))).toThrow();
  });

  it('rejects a cursor with an invalid date component', () => {
    const bad = Buffer.from('not-a-date|abc', 'utf8').toString('base64url');
    expect(() => decodeCursor(bad)).toThrow();
  });

  it('rejects a cursor with an empty id', () => {
    const bad = Buffer.from('2026-08-17T00:00:00.000Z|', 'utf8').toString('base64url');
    expect(() => decodeCursor(bad)).toThrow();
  });
});
