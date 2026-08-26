/**
 * Deliberately simple condition-matching engine for BankRule, per the Phase 5 scoping decision:
 * field/operator/value conditions only, combined with AND (matchAny: false) or OR (matchAny: true)
 * -- not a general expression DSL. Pure and synchronous so it can run both at import time (per row)
 * and on-demand from the transactions list without any DB access of its own.
 */

export type BankRuleField = 'description' | 'reference' | 'amountMinor' | 'direction';
export type BankRuleOperator = 'contains' | 'equals' | 'gt' | 'gte' | 'lt' | 'lte';

export interface BankRuleCondition {
  field: BankRuleField;
  operator: BankRuleOperator;
  value: string;
}

export interface BankRuleMatchable {
  description: string;
  reference: string | null;
  amountMinor: bigint;
  direction: 'INFLOW' | 'OUTFLOW';
}

export function parseConditions(raw: unknown): BankRuleCondition[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is BankRuleCondition =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as BankRuleCondition).field === 'string' &&
      typeof (entry as BankRuleCondition).operator === 'string' &&
      typeof (entry as BankRuleCondition).value === 'string',
  );
}

function fieldValue(field: BankRuleField, transaction: BankRuleMatchable): string {
  switch (field) {
    case 'description':
      return transaction.description;
    case 'reference':
      return transaction.reference ?? '';
    case 'amountMinor':
      return transaction.amountMinor.toString();
    case 'direction':
      return transaction.direction;
  }
}

function conditionMatches(condition: BankRuleCondition, transaction: BankRuleMatchable): boolean {
  const actual = fieldValue(condition.field, transaction);
  switch (condition.operator) {
    case 'contains':
      return actual.toLowerCase().includes(condition.value.toLowerCase());
    case 'equals':
      return actual.toLowerCase() === condition.value.toLowerCase();
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const actualNum = Number(actual);
      const valueNum = Number(condition.value);
      if (Number.isNaN(actualNum) || Number.isNaN(valueNum)) return false;
      if (condition.operator === 'gt') return actualNum > valueNum;
      if (condition.operator === 'gte') return actualNum >= valueNum;
      if (condition.operator === 'lt') return actualNum < valueNum;
      return actualNum <= valueNum;
    }
  }
}

export function ruleMatches(
  conditions: readonly BankRuleCondition[],
  matchAny: boolean,
  transaction: BankRuleMatchable,
): boolean {
  if (conditions.length === 0) return false;
  return matchAny
    ? conditions.some((condition) => conditionMatches(condition, transaction))
    : conditions.every((condition) => conditionMatches(condition, transaction));
}

export interface BankRuleSuggestion {
  ruleId: string;
  suggestedAccountId: string | null;
  suggestedContactId: string | null;
  suggestedVendorId: string | null;
  suggestedTags: string[];
}

/** Evaluates active rules in priority order (ascending -- lower number wins first), applying each
 * match's suggestions over any prior match's, stopping at the first rule flagged `stopOnMatch`. */
export function resolveSuggestion(
  rules: readonly {
    id: string;
    priority: number;
    active: boolean;
    matchAny: boolean;
    conditions: unknown;
    stopOnMatch: boolean;
    suggestAccountId: string | null;
    suggestContactId: string | null;
    suggestVendorId: string | null;
    suggestTags: string[];
  }[],
  transaction: BankRuleMatchable,
): BankRuleSuggestion | null {
  let result: BankRuleSuggestion | null = null;
  const ordered = [...rules].filter((rule) => rule.active).sort((a, b) => a.priority - b.priority);
  for (const rule of ordered) {
    if (!ruleMatches(parseConditions(rule.conditions), rule.matchAny, transaction)) continue;
    result = {
      ruleId: rule.id,
      suggestedAccountId: rule.suggestAccountId,
      suggestedContactId: rule.suggestContactId,
      suggestedVendorId: rule.suggestVendorId,
      suggestedTags: rule.suggestTags,
    };
    if (rule.stopOnMatch) break;
  }
  return result;
}
