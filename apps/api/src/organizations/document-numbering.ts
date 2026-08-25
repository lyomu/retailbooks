import type { NumberingReset } from '@prisma/client';

import { currentFiscalYearStart } from './fiscal-periods.calendar.js';

export const JOURNAL_DOCUMENT_TYPE = 'JOURNAL';
export const INVOICE_DOCUMENT_TYPE = 'INVOICE';
export const CREDIT_NOTE_DOCUMENT_TYPE = 'CREDIT_NOTE';
export const QUOTE_DOCUMENT_TYPE = 'QUOTE';
export const SALES_ORDER_DOCUMENT_TYPE = 'SALES_ORDER';
export const PAYMENT_RECEIVED_DOCUMENT_TYPE = 'PAYMENT_RECEIVED';
export const PURCHASE_ORDER_DOCUMENT_TYPE = 'PURCHASE_ORDER';
export const BILL_DOCUMENT_TYPE = 'BILL';
export const EXPENSE_DOCUMENT_TYPE = 'EXPENSE';
export const VENDOR_CREDIT_DOCUMENT_TYPE = 'VENDOR_CREDIT';
export const PAYMENT_MADE_DOCUMENT_TYPE = 'PAYMENT_MADE';

/**
 * Document types managed through the generalized `DocumentNumberingConfig` table
 * (`DocumentNumberingService#allocateDocumentNumberWithClient`). JOURNAL is deliberately excluded:
 * it keeps its dedicated `OrganizationPreference` columns and its own endpoints.
 */
export const GENERALIZED_DOCUMENT_TYPES = [
  INVOICE_DOCUMENT_TYPE,
  CREDIT_NOTE_DOCUMENT_TYPE,
  QUOTE_DOCUMENT_TYPE,
  SALES_ORDER_DOCUMENT_TYPE,
  PAYMENT_RECEIVED_DOCUMENT_TYPE,
  PURCHASE_ORDER_DOCUMENT_TYPE,
  BILL_DOCUMENT_TYPE,
  EXPENSE_DOCUMENT_TYPE,
  VENDOR_CREDIT_DOCUMENT_TYPE,
  PAYMENT_MADE_DOCUMENT_TYPE,
] as const;

export type GeneralizedDocumentType = (typeof GENERALIZED_DOCUMENT_TYPES)[number];

export function isGeneralizedDocumentType(value: string): value is GeneralizedDocumentType {
  return (GENERALIZED_DOCUMENT_TYPES as readonly string[]).includes(value);
}

export interface NumberingConfig {
  readonly prefix: string;
  readonly numberPadding: number;
  readonly numberingReset: NumberingReset;
  readonly fiscalYearStartMonth: number;
  readonly fiscalYearStartDay: number;
  readonly timeZone: string;
}

export interface NumberingScope {
  readonly key: string;
  readonly token: string | null;
}

export function numberingScopeKey(date: Date, config: NumberingConfig): NumberingScope {
  const localDate = localIsoDate(date, config.timeZone);
  if (config.numberingReset === 'NEVER') return { key: 'ALL', token: null };

  if (config.numberingReset === 'MONTHLY') {
    const token = localDate.slice(0, 7);
    return { key: token, token };
  }

  const startsOn = currentFiscalYearStart(
    date,
    config.timeZone,
    config.fiscalYearStartMonth,
    config.fiscalYearStartDay,
  );
  const token = `FY${startsOn.slice(0, 4)}`;
  return { key: token, token };
}

export function formatDocumentNumber(
  prefix: string,
  sequenceNumber: number,
  padding: number,
  scopeToken?: string | null,
): string {
  const normalizedPrefix = prefix.trim().toUpperCase();
  const number = String(sequenceNumber).padStart(padding, '0');
  return scopeToken
    ? `${normalizedPrefix}-${scopeToken}-${number}`
    : `${normalizedPrefix}-${number}`;
}

export function assertNumberingConfig(config: {
  readonly prefix: string;
  readonly numberPadding: number;
  readonly nextNumber: number;
}): void {
  if (!/^[A-Z0-9-]{1,12}$/.test(config.prefix)) {
    throw new RangeError(
      'Document prefixes may contain uppercase letters, numbers, and hyphens only.',
    );
  }
  if (
    !Number.isInteger(config.numberPadding) ||
    config.numberPadding < 1 ||
    config.numberPadding > 10
  ) {
    throw new RangeError('Number padding must be an integer from 1 to 10.');
  }
  if (!Number.isInteger(config.nextNumber) || config.nextNumber < 1) {
    throw new RangeError('Next number must be a positive integer.');
  }
}

function localIsoDate(value: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) throw new RangeError(`Could not resolve local date in ${timeZone}`);
  return `${year}-${month}-${day}`;
}
