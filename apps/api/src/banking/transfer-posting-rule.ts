import type { PostingRule, PostingRuleSourceContext } from '../posting-rules/posting-rule.js';
import { accountIdRef, systemKeyRef } from '../posting-rules/posting-rule.js';

export interface TransferPostSource extends PostingRuleSourceContext {
  description: string;
  sourceGlAccountId: string;
  destinationGlAccountId: string;
  /** Both already converted to the organization's base currency -- the journal always posts in
   * base currency since the two legs' native currencies can differ (see TransfersService). */
  sourceBaseMinor: bigint;
  destinationBaseMinor: bigint;
}

/**
 * Balanced Transfer posting: Cr source financial account's GL / Dr destination financial account's
 * GL. When the two legs' base-currency-equivalent amounts differ (a real currency exchange
 * happened as part of the transfer, not just a same-currency move), the difference is a realized
 * FX gain/loss plugged in directly -- mirrors `LedgerService#prepareFxPosting`'s own debit-short ->
 * fx_loss / credit-short -> fx_gain convention, computed here rather than relying on that
 * mechanism, since `PostingRuleLineSpec` has no per-line `foreignAmountMinor` to trigger it.
 */
export const TRANSFER_POST_RULE: PostingRule<TransferPostSource> = {
  event: 'TRANSFER_POST',
  sourceType: 'TRANSFER',
  version: 1,
  describe: (source) => source.description,
  lines: (source) => {
    const lines = [
      {
        account: accountIdRef(source.sourceGlAccountId),
        debitMinor: 0n,
        creditMinor: source.sourceBaseMinor,
        description: source.description,
      },
      {
        account: accountIdRef(source.destinationGlAccountId),
        debitMinor: source.destinationBaseMinor,
        creditMinor: 0n,
        description: source.description,
      },
    ];
    if (source.destinationBaseMinor > source.sourceBaseMinor) {
      lines.push({
        account: systemKeyRef('fx_gain'),
        debitMinor: 0n,
        creditMinor: source.destinationBaseMinor - source.sourceBaseMinor,
        description: `Realized FX gain on transfer: ${source.description}`,
      });
    } else if (source.destinationBaseMinor < source.sourceBaseMinor) {
      lines.push({
        account: systemKeyRef('fx_loss'),
        debitMinor: source.sourceBaseMinor - source.destinationBaseMinor,
        creditMinor: 0n,
        description: `Realized FX loss on transfer: ${source.description}`,
      });
    }
    return lines;
  },
};
