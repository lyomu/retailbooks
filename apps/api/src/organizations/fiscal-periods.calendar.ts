export interface FiscalPeriodDraft {
  readonly code: string;
  readonly name: string;
  readonly startsOn: string;
  readonly endsOn: string;
}

export interface FiscalYearDraft {
  readonly label: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly periods: readonly FiscalPeriodDraft[];
}

export function generateFiscalYearDraft(startsOn: string): FiscalYearDraft {
  assertIsoDate(startsOn);
  const endDate = addDays(addYears(startsOn, 1), -1);
  const startYear = Number(startsOn.slice(0, 4));
  const label = `FY${startYear}`;

  const periods: FiscalPeriodDraft[] = [];
  for (let index = 0; index < 12; index += 1) {
    const periodStart = addMonthsClamped(startsOn, index);
    const nextStart = addMonthsClamped(startsOn, index + 1);
    periods.push({
      code: `${label}-P${String(index + 1).padStart(2, '0')}`,
      name: `${label} period ${index + 1}`,
      startsOn: periodStart,
      endsOn: addDays(nextStart, -1),
    });
  }

  return {
    label,
    startsOn,
    endsOn: endDate,
    periods,
  };
}

export function currentFiscalYearStart(
  instant: Date,
  timeZone: string,
  startMonth: number,
  startDay: number,
): string {
  const local = localDateParts(instant, timeZone);
  const startsThisYear = isoDate(local.year, startMonth, startDay);
  const localIso = isoDate(local.year, local.month, local.day);
  return localIso >= startsThisYear
    ? startsThisYear
    : isoDate(local.year - 1, startMonth, startDay);
}

export function assertIsoDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError('Expected an ISO calendar date in YYYY-MM-DD format.');
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new RangeError('Expected a real ISO calendar date.');
  }
}

export function addMonthsClamped(value: string, months: number): string {
  assertIsoDate(value);
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const targetMonthIndex = month - 1 + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const normalizedMonthIndex = positiveModulo(targetMonthIndex, 12);
  const targetMonth = normalizedMonthIndex + 1;
  const targetDay = Math.min(day, daysInMonth(targetYear, targetMonth));
  return isoDate(targetYear, targetMonth, targetDay);
}

export function addYears(value: string, years: number): string {
  assertIsoDate(value);
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  return isoDate(year + years, month, Math.min(day, daysInMonth(year + years, month)));
}

export function addDays(value: string, days: number): string {
  assertIsoDate(value);
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function localDateParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  if (!year || !month || !day) throw new RangeError(`Could not resolve local date in ${timeZone}`);
  return { year, month, day };
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}
