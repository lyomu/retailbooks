import type { RecurringCadence } from '@prisma/client';

/** Shared by RecurringInvoicesService, RecurringBillsService, and RecurringExpensesService --
 * extracted here rather than duplicated a second and third time. */
export function advanceCadence(date: Date, cadence: RecurringCadence): Date {
  if (cadence === 'WEEKLY') {
    const next = new Date(date);
    next.setUTCDate(next.getUTCDate() + 7);
    return next;
  }
  const months = cadence === 'MONTHLY' ? 1 : cadence === 'QUARTERLY' ? 3 : 12;
  return addMonthsClamped(date, months);
}

/**
 * Adds whole months to a UTC date, clamping the day-of-month to the last valid day of the target
 * month rather than letting it overflow into the following month -- `Date.prototype.setUTCMonth`
 * overflows when the target month is shorter than the source day-of-month (e.g. Jan 31 + 1 month
 * would otherwise become Mar 3, not Feb 28/29).
 */
export function addMonthsClamped(date: Date, months: number): Date {
  const day = date.getUTCDate();
  const next = new Date(date);
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  const daysInTargetMonth = new Date(
    Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0),
  ).getUTCDate();
  next.setUTCDate(Math.min(day, daysInTargetMonth));
  return next;
}
