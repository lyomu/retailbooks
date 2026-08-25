import type { PostingRule, PostingRuleSourceContext } from '../posting-rules/posting-rule.js';
import { accountIdRef } from '../posting-rules/posting-rule.js';

export interface InvoiceIssueSource extends PostingRuleSourceContext {
  contactName: string;
  arAccountId: string;
  /** One entry per distinct revenue account, amounts are credits. */
  revenueByAccount: readonly { accountId: string; amountMinor: bigint }[];
  /** One entry per distinct tax code, amounts are credits. */
  taxByCode: readonly { accountId: string; amountMinor: bigint }[];
  /** Subtotal plus tax -- the full AR debit. */
  totalMinor: bigint;
}

/**
 * Canonical invoice-issue posting (build spec §6): Dr Accounts Receivable / Cr Revenue + Tax
 * Payable, consolidated per distinct revenue account and per distinct tax code exactly as the
 * hand-rolled version did. Declared here so the journal output is reviewable as a single declarative
 * artifact and executed through `PostingRulesService`, inheriting its validation and traceability.
 */
export const INVOICE_ISSUE_RULE: PostingRule<InvoiceIssueSource> = {
  event: 'INVOICE_ISSUE',
  sourceType: 'SALES_INVOICE',
  version: 1,
  describe: (source) => `Invoice for ${source.contactName}`,
  lines: (source) => [
    {
      account: accountIdRef(source.arAccountId),
      debitMinor: source.totalMinor,
      creditMinor: 0n,
      description: `Invoice for ${source.contactName}`,
    },
    ...source.revenueByAccount.map((entry) => ({
      account: accountIdRef(entry.accountId),
      debitMinor: 0n,
      creditMinor: entry.amountMinor,
      description: `Invoice for ${source.contactName}`,
    })),
    ...source.taxByCode.map((entry) => ({
      account: accountIdRef(entry.accountId),
      debitMinor: 0n,
      creditMinor: entry.amountMinor,
      description: `Invoice tax for ${source.contactName}`,
    })),
  ],
};
