import { describe, expect, it } from 'vitest';

import { diffFields } from '../src/organizations/audit-event.js';

describe('diffFields', () => {
  it('reports only fields that changed', () => {
    const before = { name: 'Old', code: '1000', description: 'x' };
    const after = { name: 'New', code: '1000', description: 'x' };

    const diff = diffFields(before, after, ['name', 'code', 'description']);

    expect(diff.changed).toEqual(['name']);
    expect(diff.before).toEqual({ name: 'Old' });
    expect(diff.after).toEqual({ name: 'New' });
  });

  it('returns an empty diff when nothing in the tracked fields changed', () => {
    const before = { name: 'Same', untracked: 1 };
    const after = { name: 'Same', untracked: 999 };

    const diff = diffFields(before, after, ['name']);

    expect(diff.changed).toEqual([]);
    expect(diff.before).toEqual({});
    expect(diff.after).toEqual({});
  });

  it('does not treat equal Date values as changed', () => {
    const before = { at: new Date('2026-01-01T00:00:00.000Z') };
    const after = { at: new Date('2026-01-01T00:00:00.000Z') };

    expect(diffFields(before, after, ['at']).changed).toEqual([]);
  });

  it('does not treat equal BigInt values as changed', () => {
    const before = { amountMinor: 12_345n };
    const after = { amountMinor: 12_345n };

    expect(diffFields(before, after, ['amountMinor']).changed).toEqual([]);
  });

  it('detects a BigInt change', () => {
    const diff = diffFields({ amountMinor: 100n }, { amountMinor: 200n }, ['amountMinor']);
    expect(diff.changed).toEqual(['amountMinor']);
  });

  it('treats null and undefined as equivalent, so clearing a field twice is not a change', () => {
    const diff = diffFields({ note: null }, { note: undefined }, ['note']);
    expect(diff.changed).toEqual([]);
  });

  it('detects a transition from a value to null', () => {
    const diff = diffFields({ note: 'was set' }, { note: null }, ['note']);
    expect(diff.changed).toEqual(['note']);
    expect(diff.after).toEqual({ note: null });
  });

  it('compares nested objects by value, not by reference', () => {
    const before = { metadata: { a: 1 } };
    const after = { metadata: { a: 1 } };
    expect(diffFields(before, after, ['metadata']).changed).toEqual([]);

    const changed = diffFields({ metadata: { a: 1 } }, { metadata: { a: 2 } }, ['metadata']);
    expect(changed.changed).toEqual(['metadata']);
  });
});
