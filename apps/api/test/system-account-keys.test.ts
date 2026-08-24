import { describe, expect, it } from 'vitest';

import {
  SYSTEM_ACCOUNT_KEYS,
  starterChartForTemplate,
  type SystemAccountKey,
} from '../src/organizations/ledger-starter-chart.js';

const TEMPLATES = ['general-business', 'retail', 'services', 'nonprofit'];

describe('system account keys', () => {
  it('defines exactly the thirteen keys the specification requires', () => {
    expect([...SYSTEM_ACCOUNT_KEYS].sort()).toEqual(
      [
        'accounts_payable',
        'accounts_receivable',
        'bank_default',
        'cogs',
        'fx_gain',
        'fx_loss',
        'general_expense',
        'inventory_asset',
        'retained_earnings',
        'rounding',
        'sales_revenue',
        'tax_payable',
        'tax_receivable',
      ].sort(),
    );
  });

  it.each(TEMPLATES)('binds every system key exactly once in the %s chart', (template) => {
    const bound = starterChartForTemplate(template)
      .map((account) => account.systemKey)
      .filter((key): key is SystemAccountKey => Boolean(key));

    expect([...bound].sort()).toEqual([...SYSTEM_ACCOUNT_KEYS].sort());
    expect(new Set(bound).size).toBe(bound.length);
  });

  it.each(TEMPLATES)('keeps account codes unique in the %s chart', (template) => {
    const codes = starterChartForTemplate(template).map((account) => account.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('marks only subledger control accounts as control accounts', () => {
    const control = starterChartForTemplate('general-business')
      .filter((account) => account.isControl)
      .map((account) => account.systemKey);

    expect([...control].sort()).toEqual([
      'accounts_payable',
      'accounts_receivable',
      'inventory_asset',
      'tax_payable',
      'tax_receivable',
    ]);
  });

  it('gives every control account a system key, so protection cannot be bypassed', () => {
    const controlWithoutKey = starterChartForTemplate('general-business').filter(
      (account) => account.isControl && !account.systemKey,
    );

    expect(controlWithoutKey).toEqual([]);
  });

  it('assigns each system account a normal balance consistent with its type', () => {
    const chart = starterChartForTemplate('general-business');
    const byKey = new Map(chart.filter((a) => a.systemKey).map((a) => [a.systemKey, a]));

    expect(byKey.get('accounts_receivable')?.normalBalance).toBe('DEBIT');
    expect(byKey.get('accounts_payable')?.normalBalance).toBe('CREDIT');
    expect(byKey.get('sales_revenue')?.normalBalance).toBe('CREDIT');
    expect(byKey.get('cogs')?.normalBalance).toBe('DEBIT');
    expect(byKey.get('fx_gain')?.normalBalance).toBe('CREDIT');
    expect(byKey.get('fx_loss')?.normalBalance).toBe('DEBIT');
  });
});
