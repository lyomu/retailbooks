import type { LedgerAccountType, LedgerNormalBalance } from '@prisma/client';

export interface StarterAccount {
  readonly code: string;
  readonly name: string;
  readonly type: LedgerAccountType;
  readonly normalBalance: LedgerNormalBalance;
  readonly description?: string;
  /** Stable identifier later modules resolve against instead of matching on code or name. */
  readonly systemKey?: SystemAccountKey;
  /** Subledger control account: postings should originate from their module, not manual journals. */
  readonly isControl?: boolean;
}

/** The system account keys required by the Phase 1 specification. */
export const SYSTEM_ACCOUNT_KEYS = [
  'accounts_receivable',
  'accounts_payable',
  'sales_revenue',
  'general_expense',
  'bank_default',
  'tax_payable',
  'tax_receivable',
  'inventory_asset',
  'cogs',
  'retained_earnings',
  'fx_gain',
  'fx_loss',
  'rounding',
  'customer_credit',
] as const;

export type SystemAccountKey = (typeof SYSTEM_ACCOUNT_KEYS)[number];

const d = 'DEBIT' satisfies LedgerNormalBalance;
const c = 'CREDIT' satisfies LedgerNormalBalance;

const generalBusinessAccounts: readonly StarterAccount[] = Object.freeze([
  { code: '1000', name: 'Cash on hand', type: 'ASSET', normalBalance: d },
  {
    code: '1010',
    name: 'Bank account - operating',
    type: 'ASSET',
    normalBalance: d,
    systemKey: 'bank_default',
  },
  { code: '1020', name: 'Bank account - savings', type: 'ASSET', normalBalance: d },
  { code: '1030', name: 'Mobile money wallet', type: 'ASSET', normalBalance: d },
  { code: '1040', name: 'Payment processor clearing', type: 'ASSET', normalBalance: d },
  {
    code: '1100',
    name: 'Trade receivables',
    type: 'ASSET',
    normalBalance: d,
    systemKey: 'accounts_receivable',
    isControl: true,
  },
  { code: '1110', name: 'Allowance for doubtful debts', type: 'ASSET', normalBalance: c },
  { code: '1120', name: 'Staff advances', type: 'ASSET', normalBalance: d },
  { code: '1130', name: 'Supplier deposits', type: 'ASSET', normalBalance: d },
  {
    code: '1200',
    name: 'Inventory',
    type: 'ASSET',
    normalBalance: d,
    systemKey: 'inventory_asset',
    isControl: true,
  },
  { code: '1300', name: 'Prepaid expenses', type: 'ASSET', normalBalance: d },
  {
    code: '1400',
    name: 'Input tax recoverable',
    type: 'ASSET',
    normalBalance: d,
    systemKey: 'tax_receivable',
    isControl: true,
  },
  { code: '1500', name: 'Furniture and fittings', type: 'ASSET', normalBalance: d },
  { code: '1510', name: 'Computer equipment', type: 'ASSET', normalBalance: d },
  { code: '1520', name: 'Office equipment', type: 'ASSET', normalBalance: d },
  { code: '1590', name: 'Accumulated depreciation', type: 'ASSET', normalBalance: c },
  {
    code: '2000',
    name: 'Trade payables',
    type: 'LIABILITY',
    normalBalance: c,
    systemKey: 'accounts_payable',
    isControl: true,
  },
  { code: '2010', name: 'Accrued expenses', type: 'LIABILITY', normalBalance: c },
  { code: '2020', name: 'Customer deposits', type: 'LIABILITY', normalBalance: c },
  {
    code: '2025',
    name: 'Customer credit balance',
    type: 'LIABILITY',
    normalBalance: c,
    systemKey: 'customer_credit',
    isControl: true,
  },
  { code: '2030', name: 'Payroll payable', type: 'LIABILITY', normalBalance: c },
  { code: '2040', name: 'Withholding tax payable', type: 'LIABILITY', normalBalance: c },
  {
    code: '2050',
    name: 'Output tax payable',
    type: 'LIABILITY',
    normalBalance: c,
    systemKey: 'tax_payable',
    isControl: true,
  },
  { code: '2060', name: 'Sales tax control', type: 'LIABILITY', normalBalance: c },
  { code: '2100', name: 'Short-term loan', type: 'LIABILITY', normalBalance: c },
  { code: '2200', name: 'Long-term loan', type: 'LIABILITY', normalBalance: c },
  { code: '3000', name: 'Owner capital', type: 'EQUITY', normalBalance: c },
  { code: '3010', name: 'Owner drawings', type: 'EQUITY', normalBalance: d },
  { code: '3020', name: 'Share capital', type: 'EQUITY', normalBalance: c },
  {
    code: '3030',
    name: 'Retained earnings',
    type: 'EQUITY',
    normalBalance: c,
    systemKey: 'retained_earnings',
  },
  { code: '3040', name: 'Current year earnings', type: 'EQUITY', normalBalance: c },
  {
    code: '4000',
    name: 'Sales revenue',
    type: 'REVENUE',
    normalBalance: c,
    systemKey: 'sales_revenue',
  },
  { code: '4010', name: 'Service income', type: 'REVENUE', normalBalance: c },
  { code: '4020', name: 'Consulting income', type: 'REVENUE', normalBalance: c },
  { code: '4030', name: 'Commission income', type: 'REVENUE', normalBalance: c },
  { code: '4040', name: 'Discounts given', type: 'REVENUE', normalBalance: d },
  { code: '4050', name: 'Sales returns and allowances', type: 'REVENUE', normalBalance: d },
  { code: '5000', name: 'Rent expense', type: 'EXPENSE', normalBalance: d },
  { code: '5010', name: 'Utilities expense', type: 'EXPENSE', normalBalance: d },
  { code: '5020', name: 'Internet and communications', type: 'EXPENSE', normalBalance: d },
  { code: '5030', name: 'Salaries and wages', type: 'EXPENSE', normalBalance: d },
  { code: '5040', name: 'Contract labor', type: 'EXPENSE', normalBalance: d },
  { code: '5050', name: 'Staff welfare', type: 'EXPENSE', normalBalance: d },
  { code: '5060', name: 'Office supplies', type: 'EXPENSE', normalBalance: d },
  { code: '5070', name: 'Repairs and maintenance', type: 'EXPENSE', normalBalance: d },
  { code: '5080', name: 'Transport and delivery', type: 'EXPENSE', normalBalance: d },
  { code: '5090', name: 'Travel expense', type: 'EXPENSE', normalBalance: d },
  { code: '5100', name: 'Meals and entertainment', type: 'EXPENSE', normalBalance: d },
  { code: '5110', name: 'Marketing and advertising', type: 'EXPENSE', normalBalance: d },
  { code: '5120', name: 'Professional fees', type: 'EXPENSE', normalBalance: d },
  { code: '5130', name: 'Bank charges', type: 'EXPENSE', normalBalance: d },
  { code: '5140', name: 'Insurance expense', type: 'EXPENSE', normalBalance: d },
  { code: '5150', name: 'Subscriptions and software', type: 'EXPENSE', normalBalance: d },
  { code: '5160', name: 'Licenses and permits', type: 'EXPENSE', normalBalance: d },
  { code: '5170', name: 'Depreciation expense', type: 'EXPENSE', normalBalance: d },
  { code: '5180', name: 'Bad debt expense', type: 'EXPENSE', normalBalance: d },
  {
    code: '5190',
    name: 'Miscellaneous expense',
    type: 'EXPENSE',
    normalBalance: d,
    systemKey: 'general_expense',
  },
  {
    code: '6000',
    name: 'Cost of goods sold',
    type: 'COST_OF_SALES',
    normalBalance: d,
    systemKey: 'cogs',
  },
  { code: '6010', name: 'Purchases', type: 'COST_OF_SALES', normalBalance: d },
  { code: '6020', name: 'Purchase returns', type: 'COST_OF_SALES', normalBalance: c },
  { code: '6030', name: 'Freight inwards', type: 'COST_OF_SALES', normalBalance: d },
  { code: '6040', name: 'Inventory adjustments', type: 'COST_OF_SALES', normalBalance: d },
  { code: '7000', name: 'Interest income', type: 'OTHER_INCOME', normalBalance: c },
  {
    code: '7010',
    name: 'Foreign exchange gain',
    type: 'OTHER_INCOME',
    normalBalance: c,
    systemKey: 'fx_gain',
  },
  { code: '7100', name: 'Interest expense', type: 'OTHER_EXPENSE', normalBalance: d },
  {
    code: '7110',
    name: 'Foreign exchange loss',
    type: 'OTHER_EXPENSE',
    normalBalance: d,
    systemKey: 'fx_loss',
  },
  {
    code: '7120',
    name: 'Rounding differences',
    type: 'OTHER_EXPENSE',
    normalBalance: d,
    systemKey: 'rounding',
  },
]);

const templateAdditions: Readonly<Record<string, readonly StarterAccount[]>> = Object.freeze({
  retail: [
    { code: '1210', name: 'Goods for resale', type: 'ASSET', normalBalance: d },
    { code: '1220', name: 'Inventory in transit', type: 'ASSET', normalBalance: d },
    { code: '4060', name: 'Delivery income', type: 'REVENUE', normalBalance: c },
    { code: '6050', name: 'Shrinkage and wastage', type: 'COST_OF_SALES', normalBalance: d },
    { code: '6060', name: 'Packaging costs', type: 'COST_OF_SALES', normalBalance: d },
    { code: '6070', name: 'Merchant fees', type: 'COST_OF_SALES', normalBalance: d },
  ],
  services: [
    { code: '4060', name: 'Project income', type: 'REVENUE', normalBalance: c },
    { code: '4070', name: 'Retainer income', type: 'REVENUE', normalBalance: c },
    { code: '5200', name: 'Billable subcontractors', type: 'EXPENSE', normalBalance: d },
    { code: '5210', name: 'Training and development', type: 'EXPENSE', normalBalance: d },
    { code: '5220', name: 'Client reimbursable costs', type: 'EXPENSE', normalBalance: d },
  ],
  nonprofit: [
    { code: '3050', name: 'Restricted fund balance', type: 'EQUITY', normalBalance: c },
    { code: '4060', name: 'Grant income', type: 'REVENUE', normalBalance: c },
    { code: '4070', name: 'Donation income', type: 'REVENUE', normalBalance: c },
    { code: '5200', name: 'Programme expenses', type: 'EXPENSE', normalBalance: d },
    { code: '5210', name: 'Monitoring and evaluation', type: 'EXPENSE', normalBalance: d },
    { code: '5220', name: 'Fundraising expense', type: 'EXPENSE', normalBalance: d },
  ],
  'general-business': [],
});

export function starterChartForTemplate(template: string): readonly StarterAccount[] {
  const additions = templateAdditions[template] ?? [];
  return dedupeByCode([...generalBusinessAccounts, ...additions]);
}

function dedupeByCode(accounts: readonly StarterAccount[]): readonly StarterAccount[] {
  const byCode = new Map<string, StarterAccount>();
  for (const account of accounts) byCode.set(account.code, account);
  return Array.from(byCode.values()).sort((a, b) => a.code.localeCompare(b.code));
}
