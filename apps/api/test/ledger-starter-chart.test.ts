import { describe, expect, it } from 'vitest';

import { DEFAULT_ROLE_PERMISSIONS, PERMISSION_KEYS } from '../src/organizations/permission-catalog';
import { starterChartForTemplate } from '../src/organizations/ledger-starter-chart';

describe('starterChartForTemplate', () => {
  it('seeds a broad general-business starter chart', () => {
    const accounts = starterChartForTemplate('general-business');

    expect(accounts.length).toBeGreaterThanOrEqual(60);
    expect(accounts.map((account) => account.code)).toEqual(
      [...accounts.map((account) => account.code)].sort((a, b) => a.localeCompare(b)),
    );
    expect(accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: '1000', type: 'ASSET', normalBalance: 'DEBIT' }),
        expect.objectContaining({ code: '2000', type: 'LIABILITY', normalBalance: 'CREDIT' }),
        expect.objectContaining({ code: '4000', type: 'REVENUE', normalBalance: 'CREDIT' }),
        expect.objectContaining({ code: '6000', type: 'COST_OF_SALES', normalBalance: 'DEBIT' }),
      ]),
    );
  });

  it('adds template-specific accounts without duplicating codes', () => {
    const retail = starterChartForTemplate('retail');
    const codes = retail.map((account) => account.code);

    expect(new Set(codes).size).toBe(codes.length);
    expect(retail).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: '1210', name: 'Goods for resale' }),
        expect.objectContaining({ code: '6050', name: 'Shrinkage and wastage' }),
      ]),
    );
  });
});

describe('ledger permission defaults', () => {
  it('grants owner every current key and keeps chart management away from accountant/staff', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.OWNER).toEqual(PERMISSION_KEYS);
    expect(DEFAULT_ROLE_PERMISSIONS.ADMIN).toContain('accounts.manage');
    expect(DEFAULT_ROLE_PERMISSIONS.ACCOUNTANT).not.toContain('accounts.manage');
    expect(DEFAULT_ROLE_PERMISSIONS.STAFF).not.toContain('accounts.manage');
    expect(DEFAULT_ROLE_PERMISSIONS.ACCOUNTANT).toContain('journals.post');
    expect(DEFAULT_ROLE_PERMISSIONS.STAFF).toContain('journals.view');
  });
});
