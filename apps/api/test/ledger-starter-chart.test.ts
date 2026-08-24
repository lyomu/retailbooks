import { describe, expect, it } from 'vitest';

import { starterChartForTemplate } from '../src/organizations/ledger-starter-chart';
import { SYSTEM_ROLE_TEMPLATES } from '../src/organizations/roles-catalog';

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
  it('grants owner every current key and keeps chart management away from accountant/viewer', () => {
    const owner = SYSTEM_ROLE_TEMPLATES.find((t) => t.key === 'OWNER');
    const admin = SYSTEM_ROLE_TEMPLATES.find((t) => t.key === 'ADMIN');
    const accountant = SYSTEM_ROLE_TEMPLATES.find((t) => t.key === 'ACCOUNTANT');
    const viewer = SYSTEM_ROLE_TEMPLATES.find((t) => t.key === 'VIEWER');

    // The owner template's own permissions list is ignored at seed time -- RolesService.
    // seedSystemRoles always grants it the full catalog regardless -- so what is asserted here is
    // that the owner template is flagged correctly, the seeding behavior itself is proven in the
    // system-accounts integration suite.
    expect(owner?.isOwnerRole).toBe(true);
    expect(admin?.permissions).toContain('accounts.create');
    expect(admin?.permissions).toContain('accounts.update');
    expect(admin?.permissions).toContain('accounts.deactivate');
    expect(accountant?.permissions).not.toContain('accounts.create');
    expect(viewer?.permissions).not.toContain('accounts.create');
    expect(accountant?.permissions).toContain('journals.post');
    expect(viewer?.permissions).toContain('journals.view');
  });
});
