import { describe, expect, it } from 'vitest';

import { isBalancedJournal } from './index';

describe('isBalancedJournal', () => {
  it('accepts an equal non-zero debit and credit', () => {
    expect(
      isBalancedJournal([
        { debitMinor: 10_000n, creditMinor: 0n },
        { debitMinor: 0n, creditMinor: 10_000n },
      ]),
    ).toBe(true);
  });

  it('rejects an unbalanced journal', () => {
    expect(
      isBalancedJournal([
        { debitMinor: 10_000n, creditMinor: 0n },
        { debitMinor: 0n, creditMinor: 9_999n },
      ]),
    ).toBe(false);
  });
});
