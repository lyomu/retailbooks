export type CountryPackStatus = 'DEMONSTRATION' | 'GENERIC_FALLBACK';

export type NumberingReset = 'NEVER' | 'ANNUAL' | 'MONTHLY';

export interface CurrencyDefinition {
  readonly code: string;
  readonly name: string;
  readonly symbol: string;
  readonly minorUnits: number;
}

export interface CountryPackDefaults {
  readonly currency: string;
  readonly locale: string;
  readonly timeZone: string;
  readonly fiscalYearStartMonth: number;
  readonly fiscalYearStartDay: number;
  readonly taxRatePercent: number;
  readonly taxIdentifierLabel: string;
  readonly chartTemplate: string;
  readonly journalPrefix: string;
  readonly numberPadding: number;
  readonly numberingReset: NumberingReset;
}

export interface CountryPack {
  readonly code: string;
  readonly version: string;
  readonly countryCode: string;
  readonly name: string;
  readonly status: CountryPackStatus;
  readonly defaults: CountryPackDefaults;
  readonly notes: readonly string[];
}

export interface FormatContext {
  readonly locale: string;
  readonly currency: string;
  readonly timeZone: string;
}

export const currencies: readonly CurrencyDefinition[] = Object.freeze([
  { code: 'AED', name: 'UAE dirham', symbol: 'AED', minorUnits: 2 },
  { code: 'AUD', name: 'Australian dollar', symbol: 'A$', minorUnits: 2 },
  { code: 'CAD', name: 'Canadian dollar', symbol: 'C$', minorUnits: 2 },
  { code: 'EUR', name: 'Euro', symbol: '€', minorUnits: 2 },
  { code: 'GBP', name: 'Pound sterling', symbol: '£', minorUnits: 2 },
  { code: 'GHS', name: 'Ghanaian cedi', symbol: 'GH₵', minorUnits: 2 },
  { code: 'INR', name: 'Indian rupee', symbol: '₹', minorUnits: 2 },
  { code: 'KES', name: 'Kenyan shilling', symbol: 'KSh', minorUnits: 2 },
  { code: 'NGN', name: 'Nigerian naira', symbol: '₦', minorUnits: 2 },
  { code: 'NZD', name: 'New Zealand dollar', symbol: 'NZ$', minorUnits: 2 },
  { code: 'RWF', name: 'Rwandan franc', symbol: 'RF', minorUnits: 0 },
  { code: 'SGD', name: 'Singapore dollar', symbol: 'S$', minorUnits: 2 },
  { code: 'TZS', name: 'Tanzanian shilling', symbol: 'TSh', minorUnits: 2 },
  { code: 'UGX', name: 'Ugandan shilling', symbol: 'USh', minorUnits: 0 },
  { code: 'USD', name: 'United States dollar', symbol: '$', minorUnits: 2 },
  { code: 'ZAR', name: 'South African rand', symbol: 'R', minorUnits: 2 },
]);

export const kenyaCountryPack = Object.freeze({
  code: 'KE',
  version: '2026.1-draft',
  countryCode: 'KE',
  name: 'Kenya demonstration pack',
  status: 'DEMONSTRATION',
  defaults: {
    currency: 'KES',
    locale: 'en-KE',
    timeZone: 'Africa/Nairobi',
    fiscalYearStartMonth: 1,
    fiscalYearStartDay: 1,
    taxRatePercent: 16,
    taxIdentifierLabel: 'KRA PIN',
    chartTemplate: 'general-business',
    journalPrefix: 'JRN',
    numberPadding: 5,
    numberingReset: 'ANNUAL',
  },
  notes: [
    'Configurable software defaults only.',
    'This pack is not a statutory certification or professional tax/accounting advice.',
  ],
} satisfies CountryPack);

export const genericFallbackCountryPack = Object.freeze({
  code: 'GENERIC',
  version: '2026.1-generic-draft',
  countryCode: 'ZZ',
  name: 'Generic fallback pack',
  status: 'GENERIC_FALLBACK',
  defaults: {
    currency: 'USD',
    locale: 'en-US',
    timeZone: 'UTC',
    fiscalYearStartMonth: 1,
    fiscalYearStartDay: 1,
    taxRatePercent: 0,
    taxIdentifierLabel: 'Tax identifier',
    chartTemplate: 'general-business',
    journalPrefix: 'JRN',
    numberPadding: 5,
    numberingReset: 'ANNUAL',
  },
  notes: [
    'Used when a country-specific pack is not available.',
    'All values are configurable software defaults and require local professional review.',
  ],
} satisfies CountryPack);

export const countryPacks: readonly CountryPack[] = Object.freeze([
  kenyaCountryPack,
  genericFallbackCountryPack,
]);

const packsByCode = new Map(countryPacks.map((pack) => [pack.code, pack]));
const currencyMinorUnits = new Map(
  currencies.map((currency) => [currency.code, currency.minorUnits]),
);

export function resolveCountryPack(code: string | null | undefined): CountryPack {
  if (!code) return genericFallbackCountryPack;
  return packsByCode.get(code.toUpperCase()) ?? genericFallbackCountryPack;
}

export function getCurrencyMinorUnits(currency: string): number {
  return currencyMinorUnits.get(currency.toUpperCase()) ?? 2;
}

export function roundCurrencyAmount(amount: number, currency: string): number {
  const minorUnits = getCurrencyMinorUnits(currency);
  const factor = 10 ** minorUnits;
  return Math.round((amount + Number.EPSILON) * factor) / factor;
}

export function formatCurrency(
  amount: number,
  context: Pick<FormatContext, 'locale' | 'currency'>,
): string {
  const minorUnits = getCurrencyMinorUnits(context.currency);
  return new Intl.NumberFormat(context.locale, {
    style: 'currency',
    currency: context.currency,
    currencyDisplay: 'narrowSymbol',
    currencySign: 'accounting',
    minimumFractionDigits: minorUnits,
    maximumFractionDigits: minorUnits,
  }).format(roundCurrencyAmount(amount, context.currency));
}

export function formatFinancialNumber(
  amount: number,
  options: { readonly locale: string; readonly minorUnits?: number; readonly accounting?: boolean },
): string {
  const minorUnits = options.minorUnits ?? 2;
  const value = roundToMinorUnits(amount, minorUnits);
  const absolute = Math.abs(value);
  const formatted = new Intl.NumberFormat(options.locale, {
    minimumFractionDigits: minorUnits,
    maximumFractionDigits: minorUnits,
  }).format(absolute);

  if (value < 0) return options.accounting ? `(${formatted})` : `-${formatted}`;
  return formatted;
}

export function formatDateInTimeZone(
  value: Date | string,
  context: Pick<FormatContext, 'locale' | 'timeZone'>,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' },
): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat(context.locale, {
    ...options,
    timeZone: context.timeZone,
  }).format(date);
}

export function formatDateTimeInTimeZone(
  value: Date | string,
  context: Pick<FormatContext, 'locale' | 'timeZone'>,
): string {
  return formatDateInTimeZone(value, context, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function localIsoDate(value: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);

  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) throw new RangeError(`Could not format date for ${timeZone}`);
  return `${year}-${month}-${day}`;
}

function roundToMinorUnits(amount: number, minorUnits: number): number {
  const factor = 10 ** minorUnits;
  return Math.round((amount + Number.EPSILON) * factor) / factor;
}
