import type { PostingRule, PostingRuleSourceContext } from '../posting-rules/posting-rule.js';
import { accountIdRef } from '../posting-rules/posting-rule.js';

export interface BankTransactionCategorizeSource extends PostingRuleSourceContext {
  description: string;
  direction: 'INFLOW' | 'OUTFLOW';
  financialAccountGlAccountId: string;
  totalMinor: bigint;
  /** One entry per category line -- a single line for a plain categorize, more than one for a split. */
  categoryLines: readonly { accountId: string; amountMinor: bigint; description?: string }[];
}

/**
 * Categorizes (or splits) a bank transaction directly against the chart of accounts: the
 * FinancialAccount's own GL account moves on one side, one or more category accounts move on the
 * other, sign-determined by `direction` (INFLOW debits the bank GL / credits categories; OUTFLOW is
 * the mirror). This is the only posting path for a bank transaction that isn't a `Match` against an
 * existing document -- a `Match` links to a document that already posted its own journal.
 */
export const BANK_TRANSACTION_CATEGORIZE_RULE: PostingRule<BankTransactionCategorizeSource> = {
  event: 'BANK_TXN_CATEGORIZE',
  sourceType: 'BANK_TRANSACTION',
  version: 1,
  describe: (source) => source.description,
  lines: (source) => {
    const bankLine =
      source.direction === 'INFLOW'
        ? {
            account: accountIdRef(source.financialAccountGlAccountId),
            debitMinor: source.totalMinor,
            creditMinor: 0n,
            description: source.description,
          }
        : {
            account: accountIdRef(source.financialAccountGlAccountId),
            debitMinor: 0n,
            creditMinor: source.totalMinor,
            description: source.description,
          };
    const categoryLines = source.categoryLines.map((line) =>
      source.direction === 'INFLOW'
        ? {
            account: accountIdRef(line.accountId),
            debitMinor: 0n,
            creditMinor: line.amountMinor,
            description: line.description ?? source.description,
          }
        : {
            account: accountIdRef(line.accountId),
            debitMinor: line.amountMinor,
            creditMinor: 0n,
            description: line.description ?? source.description,
          },
    );
    return [bankLine, ...categoryLines];
  },
};
