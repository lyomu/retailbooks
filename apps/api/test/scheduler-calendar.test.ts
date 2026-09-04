import { describe, expect, it } from 'vitest';

import { nextOccurrence, type CalendarSchedule } from '../src/automation/scheduler.service.js';

/** Formats a UTC instant back into the organization's local wall-clock as `YYYY-MM-DD HH:mm`. */
function localWallClock(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

/**
 * `nextOccurrence` is the only exported entry point of the scheduler's calendar math. It is
 * deliberately local-time-first and converts to a UTC instant afterwards, so every assertion checks
 * the returned instant reads back as the expected organization-local wall-clock rather than pinning a
 * fragile absolute timestamp (which would couple the test to a specific offset arithmetic that DST
 * makes non-obvious). `Africa/Nairobi` is UTC+3 with no DST, so it isolates calendar arithmetic from
 * offset transitions; `America/New_York` is reserved for the DST case.
 */
describe('scheduler nextOccurrence calendar arithmetic', () => {
  const nairobi = 'Africa/Nairobi';

  it('DAILY lands on today when the local time has not yet passed', () => {
    const now = new Date('2026-03-01T05:00:00.000Z'); // 08:00 Nairobi
    const next = nextOccurrence(now, { cadence: 'DAILY', localTime: '09:00' }, nairobi);
    expect(localWallClock(next, nairobi)).toBe('2026-03-01 09:00');
  });

  it('DAILY advances to tomorrow when now is already past today local time', () => {
    const now = new Date('2026-03-01T07:00:00.000Z'); // 10:00 Nairobi
    const next = nextOccurrence(now, { cadence: 'DAILY', localTime: '09:00' }, nairobi);
    expect(localWallClock(next, nairobi)).toBe('2026-03-02 09:00');
  });

  it('WEEKLY rolls forward to the configured weekday (Monday after a Sunday)', () => {
    const now = new Date('2026-03-01T05:00:00.000Z'); // Sun 2026-03-01 08:00 Nairobi
    const next = nextOccurrence(
      now,
      { cadence: 'WEEKLY', weekday: 1, localTime: '09:00' },
      nairobi,
    );
    expect(localWallClock(next, nairobi)).toBe('2026-03-02 09:00'); // Mon 2026-03-02
  });

  it('MONTHLY lands on the configured day-of-month', () => {
    const now = new Date('2026-03-01T05:00:00.000Z'); // 08:00 Nairobi
    const next = nextOccurrence(
      now,
      { cadence: 'MONTHLY', dayOfMonth: 15, localTime: '09:00' },
      nairobi,
    );
    expect(localWallClock(next, nairobi)).toBe('2026-03-15 09:00');
  });

  it('MONTHLY dayOfMonth 31 clamps to the last day of a 30-day month (April)', () => {
    const now = new Date('2026-04-01T05:00:00.000Z'); // 08:00 Nairobi
    const next = nextOccurrence(
      now,
      { cadence: 'MONTHLY', dayOfMonth: 31, localTime: '09:00' },
      nairobi,
    );
    expect(localWallClock(next, nairobi)).toBe('2026-04-30 09:00');
  });

  it('MONTHLY dayOfMonth 31 clamps to Feb 28 in a non-leap year (2026)', () => {
    const now = new Date('2026-02-01T05:00:00.000Z'); // 08:00 Nairobi
    const next = nextOccurrence(
      now,
      { cadence: 'MONTHLY', dayOfMonth: 31, localTime: '09:00' },
      nairobi,
    );
    expect(localWallClock(next, nairobi)).toBe('2026-02-28 09:00');
  });

  it('MONTHLY dayOfMonth 31 clamps to Feb 29 in a leap year (2028)', () => {
    const now = new Date('2028-02-01T05:00:00.000Z'); // 08:00 Nairobi
    const next = nextOccurrence(
      now,
      { cadence: 'MONTHLY', dayOfMonth: 31, localTime: '09:00' },
      nairobi,
    );
    expect(localWallClock(next, nairobi)).toBe('2028-02-29 09:00');
  });

  it('QUARTERLY advances a full quarter when this quarter occurrence already passed', () => {
    const now = new Date('2026-02-15T07:00:00.000Z'); // 2026-02-15 10:00 Nairobi (past 09:00)
    const schedule: CalendarSchedule = { cadence: 'QUARTERLY', dayOfMonth: 15, localTime: '09:00' };
    const next = nextOccurrence(now, schedule, nairobi);
    expect(localWallClock(next, nairobi)).toBe('2026-05-15 09:00');
  });

  it('ANNUALLY advances a full year when this year occurrence already passed', () => {
    const now = new Date('2026-03-15T07:00:00.000Z'); // 2026-03-15 10:00 Nairobi (past 09:00)
    const schedule: CalendarSchedule = { cadence: 'ANNUALLY', dayOfMonth: 15, localTime: '09:00' };
    const next = nextOccurrence(now, schedule, nairobi);
    expect(localWallClock(next, nairobi)).toBe('2027-03-15 09:00');
  });

  it('survives a DST spring-forward transition and reads back as the correct local time', () => {
    // US springs forward on 2026-03-08 at 02:00 -> 03:00 in America/New_York. A 03:30 local target
    // sits in EDT (UTC-4) on that day. The naive single-offset conversion would first guess EST
    // (UTC-5) from the wall-clock instant and land an hour early; `toUtc`'s second offset pass
    // corrects it. `now` is 00:30 EST, before the target, so the candidate is not advanced.
    const ny = 'America/New_York';
    const now = new Date('2026-03-08T05:30:00.000Z'); // 2026-03-08 00:30 EST
    const next = nextOccurrence(now, { cadence: 'DAILY', localTime: '03:30' }, ny);
    expect(localWallClock(next, ny)).toBe('2026-03-08 03:30');
  });
});
