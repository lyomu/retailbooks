import { REPORT_KEYS, type ReportDefinition, type ReportKey } from '@retailbooks/contracts';

const text = (key: string, label: string) => ({ key, label, type: 'text' as const });
const date = (key: string, label: string) => ({ key, label, type: 'date' as const });
const money = (key: string, label: string) => ({ key, label, type: 'money' as const });
const number = (key: string, label: string) => ({ key, label, type: 'number' as const });
const percent = (key: string, label: string) => ({ key, label, type: 'percent' as const });
const status = (key: string, label: string) => ({ key, label, type: 'status' as const });

type DefinitionInput = Omit<
  ReportDefinition,
  'description' | 'supportedBasis' | 'supportedCurrencyModes' | 'supportsProject' | 'supportsTag'
> &
  Partial<
    Pick<
      ReportDefinition,
      | 'description'
      | 'supportedBasis'
      | 'supportedCurrencyModes'
      | 'supportsProject'
      | 'supportsTag'
    >
  >;

function definition(input: DefinitionInput): ReportDefinition {
  return {
    description: `Traceable ${input.name.toLowerCase()} for the selected period.`,
    supportedBasis: ['ACCRUAL'],
    supportedCurrencyModes: ['BASE'],
    supportsProject: false,
    supportsTag: false,
    ...input,
  };
}

const ledgerReconciliation =
  'Sum of report debit and credit movements reconciles to posted JournalLine rows under the same filters.';
const documentReconciliation =
  'Detail rows reconcile to the corresponding organization-scoped document table and its stored totals.';

export const REPORT_DEFINITIONS: readonly ReportDefinition[] = Object.freeze([
  definition({
    key: 'financial.profit-loss',
    family: 'Financial',
    name: 'Profit & Loss',
    sourceOfTruth:
      'Posted journal lines on revenue, cost-of-sales, income, and expense accounts for the selected period.',
    reconciliation: 'Net income equals the P&L account-type slice of the trial balance.',
    columns: [
      text('account', 'Account'),
      text('section', 'Section'),
      money('amountMinor', 'Amount'),
    ],
    supportsProject: true,
    supportsTag: true,
  }),
  definition({
    key: 'financial.balance-sheet',
    family: 'Financial',
    name: 'Balance Sheet',
    sourceOfTruth:
      'Posted journal lines on ASSET, LIABILITY, and EQUITY accounts through the as-of date.',
    reconciliation:
      'Assets minus liabilities and equity equals the same trial-balance account slice.',
    columns: [
      text('account', 'Account'),
      text('section', 'Section'),
      money('amountMinor', 'Balance'),
    ],
    supportsProject: true,
    supportsTag: true,
  }),
  definition({
    key: 'financial.cash-flow',
    family: 'Financial',
    name: 'Cash Flow',
    sourceOfTruth:
      'Posted movements on CASH-class system accounts, classified by counterpart account type.',
    reconciliation:
      'Net cash movement equals closing minus opening balance of the included cash accounts.',
    columns: [text('activity', 'Activity'), money('amountMinor', 'Net movement')],
    supportedBasis: ['ACCRUAL', 'CASH'],
  }),
  definition({
    key: 'financial.trial-balance',
    family: 'Financial',
    name: 'Trial Balance',
    sourceOfTruth:
      'SQL sum of debit_minor and credit_minor on posted journal lines through the as-of date.',
    reconciliation: 'Total debits equal total credits by the immutable journal posting invariant.',
    columns: [
      text('account', 'Account'),
      text('type', 'Type'),
      money('debitMinor', 'Debit'),
      money('creditMinor', 'Credit'),
    ],
    supportsProject: true,
    supportsTag: true,
  }),
  definition({
    key: 'financial.general-ledger',
    family: 'Financial',
    name: 'General Ledger',
    sourceOfTruth:
      'Posted journal lines joined to their account and journal, ordered by date and line.',
    reconciliation: ledgerReconciliation,
    columns: [
      date('date', 'Date'),
      text('reference', 'Reference'),
      text('account', 'Account'),
      text('description', 'Description'),
      money('debitMinor', 'Debit'),
      money('creditMinor', 'Credit'),
    ],
    supportsProject: true,
    supportsTag: true,
  }),
  definition({
    key: 'financial.journal-report',
    family: 'Financial',
    name: 'Journal Report',
    sourceOfTruth: 'Posted journals and their SQL-aggregated debit and credit totals.',
    reconciliation: ledgerReconciliation,
    columns: [
      date('date', 'Date'),
      text('reference', 'Reference'),
      text('description', 'Description'),
      text('sourceType', 'Source'),
      money('debitMinor', 'Debit'),
      money('creditMinor', 'Credit'),
    ],
  }),

  ...(
    [
      [
        'receivables.aging-summary',
        'AR Aging Summary',
        [text('bucket', 'Aging bucket'), money('amountMinor', 'Outstanding')],
        'Issued invoice balances grouped into current, 1–30, 31–60, 61–90, and 90+ day buckets.',
      ],
      [
        'receivables.aging-detail',
        'AR Aging Detail',
        [
          text('customer', 'Customer'),
          text('document', 'Invoice'),
          date('dueDate', 'Due date'),
          number('daysOutstanding', 'Days outstanding'),
          money('amountMinor', 'Outstanding'),
        ],
        'Open issued invoices and their stored balance_minor as of the report date.',
      ],
      [
        'receivables.customer-balances',
        'Customer Balances',
        [text('customer', 'Customer'), money('amountMinor', 'Outstanding')],
        'Open invoice balance_minor grouped by customer.',
      ],
      [
        'receivables.invoice-details',
        'Invoice Details',
        [
          date('date', 'Date'),
          text('document', 'Invoice'),
          text('customer', 'Customer'),
          status('status', 'Status'),
          money('amountMinor', 'Total'),
          money('balanceMinor', 'Balance'),
        ],
        'Invoices issued in the selected period.',
      ],
      [
        'receivables.payments-received',
        'Payments Received',
        [
          date('date', 'Date'),
          text('document', 'Payment'),
          text('customer', 'Customer'),
          money('amountMinor', 'Amount'),
          money('unappliedMinor', 'Unapplied'),
        ],
        'Non-void payment receipts in the selected period.',
      ],
    ] as const
  ).map(([key, name, columns, sourceOfTruth]) =>
    definition({
      key,
      family: 'Receivables',
      name,
      columns: [...columns],
      sourceOfTruth,
      reconciliation:
        key.includes('aging') || key.includes('balances')
          ? 'Outstanding total reconciles to the receivables control account after unapplied credits.'
          : documentReconciliation,
      supportedCurrencyModes: ['TRANSACTION'],
    }),
  ),

  ...(
    [
      [
        'payables.aging-summary',
        'AP Aging Summary',
        [text('bucket', 'Aging bucket'), money('amountMinor', 'Outstanding')],
        'Posted bill balances grouped into current, 1–30, 31–60, 61–90, and 90+ day buckets.',
      ],
      [
        'payables.aging-detail',
        'AP Aging Detail',
        [
          text('vendor', 'Vendor'),
          text('document', 'Bill'),
          date('dueDate', 'Due date'),
          number('daysOutstanding', 'Days outstanding'),
          money('amountMinor', 'Outstanding'),
        ],
        'Open posted bills and their stored balance_minor as of the report date.',
      ],
      [
        'payables.vendor-balances',
        'Vendor Balances',
        [text('vendor', 'Vendor'), money('amountMinor', 'Outstanding')],
        'Open bill balance_minor grouped by vendor.',
      ],
      [
        'payables.bill-details',
        'Bill Details',
        [
          date('date', 'Date'),
          text('document', 'Bill'),
          text('vendor', 'Vendor'),
          status('status', 'Status'),
          money('amountMinor', 'Total'),
          money('balanceMinor', 'Balance'),
        ],
        'Bills posted in the selected period.',
      ],
      [
        'payables.payments-made',
        'Payments Made',
        [
          date('date', 'Date'),
          text('document', 'Payment'),
          text('vendor', 'Vendor'),
          money('amountMinor', 'Amount'),
          money('unappliedMinor', 'Unapplied'),
        ],
        'Non-void payments made in the selected period.',
      ],
    ] as const
  ).map(([key, name, columns, sourceOfTruth]) =>
    definition({
      key,
      family: 'Payables',
      name,
      columns: [...columns],
      sourceOfTruth,
      reconciliation:
        key.includes('aging') || key.includes('balances')
          ? 'Outstanding total reconciles to the payables control account after unapplied credits.'
          : documentReconciliation,
      supportedCurrencyModes: ['TRANSACTION'],
    }),
  ),

  ...(
    [
      ['sales.by-customer', 'Sales by Customer', text('customer', 'Customer')],
      ['sales.by-item', 'Sales by Item', text('item', 'Item')],
      ['sales.by-period', 'Sales by Period', date('period', 'Period')],
      ['sales.by-tag', 'Sales by Salesperson / Tag', text('tag', 'Tag')],
    ] as const
  ).map(([key, name, groupColumn]) =>
    definition({
      key,
      family: 'Sales',
      name,
      columns: [groupColumn, money('amountMinor', 'Sales')],
      sourceOfTruth: 'Issued invoice line_total_minor grouped by the selected business dimension.',
      reconciliation:
        'Grouped sales sum to issued invoice line totals for the same period and currency.',
      supportedCurrencyModes: ['TRANSACTION'],
      supportsTag: key === 'sales.by-tag',
    }),
  ),

  ...(
    [
      ['purchases.by-vendor', 'Purchases / Expenses by Vendor', text('vendor', 'Vendor')],
      ['purchases.by-category', 'Purchases / Expenses by Category', text('category', 'Category')],
      ['purchases.by-period', 'Purchases / Expenses by Period', date('period', 'Period')],
    ] as const
  ).map(([key, name, groupColumn]) =>
    definition({
      key,
      family: 'Purchases',
      name,
      columns: [groupColumn, money('amountMinor', 'Purchases / expenses')],
      sourceOfTruth: 'Posted bill lines plus posted expenses grouped by the selected dimension.',
      reconciliation: 'Grouped purchases and expenses sum to their posted source-document totals.',
      supportedCurrencyModes: ['TRANSACTION'],
    }),
  ),

  ...(
    [
      [
        'tax.summary',
        'Tax Summary',
        [
          text('taxCode', 'Tax code'),
          money('taxableMinor', 'Taxable base'),
          money('taxMinor', 'Tax'),
        ],
      ],
      [
        'tax.detail',
        'Tax Detail',
        [
          date('date', 'Date'),
          text('reference', 'Reference'),
          text('taxCode', 'Tax code'),
          money('taxableMinor', 'Taxable base'),
          money('taxMinor', 'Tax'),
        ],
      ],
      [
        'tax.taxable-exempt-bases',
        'Taxable / Exempt Bases',
        [text('treatment', 'Treatment'), money('taxableMinor', 'Base')],
      ],
      [
        'tax.liability-recoverable',
        'Tax Liability / Recoverable',
        [text('side', 'Side'), money('taxMinor', 'Tax')],
      ],
    ] as const
  ).map(([key, name, columns]) =>
    definition({
      key,
      family: 'Tax',
      name,
      columns: [...columns],
      sourceOfTruth:
        'Frozen tax snapshots on posted journal lines; current tax-code configuration is not substituted.',
      reconciliation:
        'Tax amounts reconcile to posted journal tax lines and the configured tax control accounts.',
    }),
  ),

  ...(
    [
      [
        'inventory.stock-on-hand',
        'Stock on Hand',
        [text('item', 'Item'), text('warehouse', 'Warehouse'), number('quantity', 'Quantity')],
      ],
      [
        'inventory.valuation',
        'Inventory Valuation',
        [
          text('item', 'Item'),
          text('warehouse', 'Warehouse'),
          number('quantity', 'Quantity'),
          money('amountMinor', 'Value'),
        ],
      ],
      [
        'inventory.movements',
        'Inventory Movements',
        [
          date('date', 'Date'),
          text('item', 'Item'),
          text('warehouse', 'Warehouse'),
          text('direction', 'Direction'),
          number('quantity', 'Quantity'),
          money('amountMinor', 'Value'),
        ],
      ],
      [
        'inventory.adjustments',
        'Inventory Adjustments',
        [
          date('date', 'Date'),
          text('item', 'Item'),
          text('warehouse', 'Warehouse'),
          status('status', 'Status'),
          number('quantity', 'Quantity delta'),
          money('amountMinor', 'Value delta'),
        ],
      ],
      [
        'inventory.reorder',
        'Reorder',
        [
          text('item', 'Item'),
          text('warehouse', 'Warehouse'),
          number('quantity', 'On hand'),
          number('reorderPoint', 'Reorder point'),
          number('suggested', 'Suggested order'),
        ],
      ],
    ] as const
  ).map(([key, name, columns]) =>
    definition({
      key,
      family: 'Inventory',
      name,
      columns: [...columns],
      sourceOfTruth:
        key === 'inventory.valuation'
          ? 'Open valuation layers and their remaining quantity/cost.'
          : 'Immutable stock movements, posted adjustments, and item reorder settings.',
      reconciliation:
        key === 'inventory.valuation'
          ? 'Total cost_remaining_minor reconciles to the inventory control account.'
          : 'Quantities reconcile to signed stock movements by item and warehouse.',
    }),
  ),

  ...(
    [
      [
        'projects.time',
        'Project Time',
        [text('project', 'Project'), number('hours', 'Hours'), money('costMinor', 'Cost')],
      ],
      [
        'projects.unbilled',
        'Unbilled Time / Expenses',
        [
          text('project', 'Project'),
          money('timeMinor', 'Unbilled time'),
          money('expenseMinor', 'Unbilled expenses'),
        ],
      ],
      [
        'projects.revenue-cost',
        'Project Revenue / Cost',
        [text('project', 'Project'), money('revenueMinor', 'Revenue'), money('costMinor', 'Cost')],
      ],
      [
        'projects.profitability',
        'Project Profitability',
        [
          text('project', 'Project'),
          money('revenueMinor', 'Revenue'),
          money('costMinor', 'Cost'),
          money('marginMinor', 'Margin'),
          percent('marginPercent', 'Margin %'),
        ],
      ],
    ] as const
  ).map(([key, name, columns]) =>
    definition({
      key,
      family: 'Projects',
      name,
      columns: [...columns],
      sourceOfTruth:
        key === 'projects.time' || key === 'projects.unbilled'
          ? 'Approved/time-entry and project-expense source rows.'
          : 'Posted journal lines frozen with project_id.',
      reconciliation:
        key.includes('revenue') || key.includes('profitability')
          ? 'Revenue and cost reconcile to project-dimensioned P&L journal lines.'
          : 'Hours and unbilled values reconcile to uninvoiced project source rows.',
      supportsProject: true,
    }),
  ),

  ...(
    [
      ['audit.transaction-history', 'Transaction History'],
      ['audit.user-activity', 'User Activity'],
      ['audit.approvals', 'Approvals'],
      ['audit.void-reversal-history', 'Void / Reversal History'],
    ] as const
  ).map(([key, name]) =>
    definition({
      key,
      family: 'Audit',
      name,
      columns: [
        date('date', 'Date'),
        text('user', 'User'),
        text('event', 'Event'),
        text('entity', 'Entity'),
        status('action', 'Action'),
      ],
      sourceOfTruth: 'Append-only AuditEvent records, joined to actor display names.',
      reconciliation:
        'Rows are a filtered projection of organization-scoped audit events and retain the source entity id.',
    }),
  ),
]);

if (REPORT_DEFINITIONS.length !== REPORT_KEYS.length) {
  throw new Error(
    `Report registry has ${REPORT_DEFINITIONS.length} definitions for ${REPORT_KEYS.length} keys.`,
  );
}

const BY_KEY = new Map<ReportKey, ReportDefinition>(
  REPORT_DEFINITIONS.map((entry) => [entry.key, entry]),
);

export function reportDefinitionFor(key: ReportKey): ReportDefinition {
  const result = BY_KEY.get(key);
  if (!result) throw new Error(`Unknown report definition: ${key}`);
  return result;
}
