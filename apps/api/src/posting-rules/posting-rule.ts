import type { SystemAccountKey } from '../organizations/ledger-starter-chart.js';

/**
 * A declarative posting rule: one named source event's translation into journal lines.
 *
 * Rules are pure declarations over a typed source-document context. They never touch the database
 * themselves and never call the ledger directly -- `PostingRulesService#post` resolves accounts,
 * validates the produced lines, and delegates to `LedgerService#postJournalFromLines`, so every
 * rule-posted journal inherits the same transaction, idempotency, period, numbering, and audit
 * path as every other posting.
 */
export interface RuleAccountRef {
  kind: 'SYSTEM_KEY' | 'ACCOUNT_ID';
  /** Present when `kind` is `'SYSTEM_KEY'`. */
  systemKey?: SystemAccountKey;
  /** Present when `kind` is `'ACCOUNT_ID'`. */
  accountId?: string;
}

export interface PostingRuleLineSpec {
  account: RuleAccountRef;
  description?: string;
  debitMinor?: bigint;
  creditMinor?: bigint;
}

/** The identity + dating context every rule source carries on top of its own document shape. */
export interface PostingRuleSourceContext {
  sourceId: string;
  journalDate: Date;
  currency: string;
}

export interface PostingRule<TSource> {
  /**
   * The event name. Doubles as the ledger idempotency operation namespace (`'INVOICE_ISSUE'`,
   * `'OPENING_BALANCE_FINALIZE'`, ...) and as half of the journal's `postingRule` traceability tag.
   */
  event: string;
  /** Written to `journals.source_type`; groups the rule's journals by document family. */
  sourceType: string;
  /** Bumped when a rule's meaning changes; recorded so history stays interpretable. */
  version: number;
  describe: (source: TSource) => string;
  lines: (source: TSource) => readonly PostingRuleLineSpec[];
}

export function systemKeyRef(systemKey: SystemAccountKey): RuleAccountRef {
  return { kind: 'SYSTEM_KEY', systemKey };
}

export function accountIdRef(accountId: string): RuleAccountRef {
  return { kind: 'ACCOUNT_ID', accountId };
}

/**
 * The `event@vN` tag written to `journals.posting_rule`, so any posted line traces back to both
 * the document (via sourceType/sourceId) and the exact rule version that produced it.
 */
export function postingRuleTag(event: string, version: number): string {
  return `${event}@v${version}`;
}
