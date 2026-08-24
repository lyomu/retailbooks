import { describe, expect, it } from 'vitest';

import {
  addMonthsClamped,
  currentFiscalYearStart,
  generateFiscalYearDraft,
} from '../src/organizations/fiscal-periods.calendar';

describe('fiscal period calendar', () => {
  it('generates twelve organization-scoped monthly periods for a fiscal year', () => {
    const draft = generateFiscalYearDraft('2026-01-01');

    expect(draft).toMatchObject({
      label: 'FY2026',
      startsOn: '2026-01-01',
      endsOn: '2026-12-31',
    });
    expect(draft.periods).toHaveLength(12);
    expect(draft.periods[0]).toMatchObject({
      code: 'FY2026-P01',
      startsOn: '2026-01-01',
      endsOn: '2026-01-31',
    });
    expect(draft.periods[11]).toMatchObject({
      code: 'FY2026-P12',
      startsOn: '2026-12-01',
      endsOn: '2026-12-31',
    });
  });

  it('clamps month-end fiscal starts to real calendar dates', () => {
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsClamped('2028-01-31', 1)).toBe('2028-02-29');
  });

  it('uses the configured time zone when deciding the active fiscal year', () => {
    const instant = new Date('2026-08-16T22:30:00.000Z');

    expect(currentFiscalYearStart(instant, 'Africa/Nairobi', 8, 17)).toBe('2026-08-17');
    expect(currentFiscalYearStart(instant, 'America/New_York', 8, 17)).toBe('2025-08-17');
  });
});
