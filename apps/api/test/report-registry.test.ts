import { REPORT_KEYS } from '@retailbooks/contracts';
import { describe, expect, it } from 'vitest';

import { REPORT_DEFINITIONS, reportDefinitionFor } from '../src/reporting/report-registry.js';

describe('report definition registry', () => {
  it('defines every public report key exactly once with source and reconciliation metadata', () => {
    expect(REPORT_DEFINITIONS).toHaveLength(REPORT_KEYS.length);
    expect(new Set(REPORT_DEFINITIONS.map((definition) => definition.key)).size).toBe(
      REPORT_KEYS.length,
    );
    expect(REPORT_DEFINITIONS.every((definition) => definition.sourceOfTruth.length > 20)).toBe(
      true,
    );
    expect(REPORT_DEFINITIONS.every((definition) => definition.reconciliation.length > 20)).toBe(
      true,
    );
    expect(REPORT_DEFINITIONS.every((definition) => definition.columns.length > 0)).toBe(true);
    for (const key of REPORT_KEYS) expect(reportDefinitionFor(key).key).toBe(key);
  });

  it('never advertises unsupported cash basis or transaction currency on financial statements', () => {
    for (const definition of REPORT_DEFINITIONS.filter((entry) =>
      ['financial.profit-loss', 'financial.balance-sheet', 'financial.trial-balance'].includes(
        entry.key,
      ),
    )) {
      expect(definition.supportedBasis).toEqual(['ACCRUAL']);
      expect(definition.supportedCurrencyModes).toEqual(['BASE']);
    }
  });
});
