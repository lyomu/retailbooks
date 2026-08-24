/**
 * Configurable jurisdiction and country-pack reference data.
 *
 * These are software defaults that make onboarding fast in common jurisdictions. They are not a
 * statutory certification, and every value stays editable per organization.
 *
 * This catalog lives inside the API rather than a workspace package because the compiled API
 * loads workspace packages as types only; the web application reads it through
 * `GET /organizations/reference-data` so both sides share one source of truth.
 */

export interface CountryDefinition {
  readonly code: string;
  readonly name: string;
  readonly defaultCurrency: string;
  readonly defaultLocale: string;
  readonly defaultTimeZone: string;
  readonly defaultFiscalStartMonth: number;
  readonly defaultFiscalStartDay: number;
  readonly countryPackCode: string;
  readonly countryPackVersion: string;
  readonly suggestedTaxRate: number;
  readonly taxIdentifierLabel: string;
}

export interface CurrencyDefinition {
  readonly code: string;
  readonly name: string;
  readonly symbol: string;
  readonly minorUnits: number;
}

export interface CountryPackDefinition {
  readonly code: string;
  readonly version: string;
  readonly countryCode: string;
  readonly name: string;
  readonly status: 'DEMONSTRATION' | 'GENERIC_FALLBACK';
  readonly defaults: {
    readonly currency: string;
    readonly locale: string;
    readonly timeZone: string;
    readonly fiscalYearStartMonth: number;
    readonly fiscalYearStartDay: number;
    readonly chartTemplate: string;
    readonly journalPrefix: string;
    readonly numberPadding: number;
    readonly numberingReset: 'NEVER' | 'ANNUAL' | 'MONTHLY';
  };
  readonly notes: readonly string[];
}

const KENYA_PACK_VERSION = '2026.1-draft';
const GENERIC_PACK_VERSION = '2026.1-generic-draft';

export const countryPacks: readonly CountryPackDefinition[] = Object.freeze([
  {
    code: 'KE',
    version: KENYA_PACK_VERSION,
    countryCode: 'KE',
    name: 'Kenya demonstration pack',
    status: 'DEMONSTRATION',
    defaults: {
      currency: 'KES',
      locale: 'en-KE',
      timeZone: 'Africa/Nairobi',
      fiscalYearStartMonth: 1,
      fiscalYearStartDay: 1,
      chartTemplate: 'general-business',
      journalPrefix: 'JRN',
      numberPadding: 5,
      numberingReset: 'ANNUAL',
    },
    notes: [
      'Configurable software defaults only.',
      'Not a statutory certification or professional tax/accounting opinion.',
    ],
  },
  {
    code: 'GENERIC',
    version: GENERIC_PACK_VERSION,
    countryCode: 'ZZ',
    name: 'Generic fallback pack',
    status: 'GENERIC_FALLBACK',
    defaults: {
      currency: 'USD',
      locale: 'en-US',
      timeZone: 'UTC',
      fiscalYearStartMonth: 1,
      fiscalYearStartDay: 1,
      chartTemplate: 'general-business',
      journalPrefix: 'JRN',
      numberPadding: 5,
      numberingReset: 'ANNUAL',
    },
    notes: [
      'Used when a country-specific pack is not available.',
      'Every value remains configurable per organization.',
    ],
  },
]);

export const countries: readonly CountryDefinition[] = Object.freeze([
  {
    code: 'KE',
    name: 'Kenya',
    defaultCurrency: 'KES',
    defaultLocale: 'en-KE',
    defaultTimeZone: 'Africa/Nairobi',
    defaultFiscalStartMonth: 1,
    defaultFiscalStartDay: 1,
    countryPackCode: 'KE',
    countryPackVersion: KENYA_PACK_VERSION,
    suggestedTaxRate: 16,
    taxIdentifierLabel: 'KRA PIN',
  },
  {
    code: 'UG',
    name: 'Uganda',
    defaultCurrency: 'UGX',
    defaultLocale: 'en-UG',
    defaultTimeZone: 'Africa/Kampala',
    defaultFiscalStartMonth: 7,
    defaultFiscalStartDay: 1,
    countryPackCode: 'GENERIC',
    countryPackVersion: GENERIC_PACK_VERSION,
    suggestedTaxRate: 18,
    taxIdentifierLabel: 'TIN',
  },
  {
    code: 'TZ',
    name: 'Tanzania',
    defaultCurrency: 'TZS',
    defaultLocale: 'en-TZ',
    defaultTimeZone: 'Africa/Dar_es_Salaam',
    defaultFiscalStartMonth: 7,
    defaultFiscalStartDay: 1,
    countryPackCode: 'GENERIC',
    countryPackVersion: GENERIC_PACK_VERSION,
    suggestedTaxRate: 18,
    taxIdentifierLabel: 'TIN',
  },
  {
    code: 'RW',
    name: 'Rwanda',
    defaultCurrency: 'RWF',
    defaultLocale: 'en-RW',
    defaultTimeZone: 'Africa/Kigali',
    defaultFiscalStartMonth: 1,
    defaultFiscalStartDay: 1,
    countryPackCode: 'GENERIC',
    countryPackVersion: GENERIC_PACK_VERSION,
    suggestedTaxRate: 18,
    taxIdentifierLabel: 'TIN',
  },
  {
    code: 'NG',
    name: 'Nigeria',
    defaultCurrency: 'NGN',
    defaultLocale: 'en-NG',
    defaultTimeZone: 'Africa/Lagos',
    defaultFiscalStartMonth: 1,
    defaultFiscalStartDay: 1,
    countryPackCode: 'GENERIC',
    countryPackVersion: GENERIC_PACK_VERSION,
    suggestedTaxRate: 7.5,
    taxIdentifierLabel: 'TIN',
  },
  {
    code: 'GH',
    name: 'Ghana',
    defaultCurrency: 'GHS',
    defaultLocale: 'en-GH',
    defaultTimeZone: 'Africa/Accra',
    defaultFiscalStartMonth: 1,
    defaultFiscalStartDay: 1,
    countryPackCode: 'GENERIC',
    countryPackVersion: GENERIC_PACK_VERSION,
    suggestedTaxRate: 15,
    taxIdentifierLabel: 'TIN',
  },
  {
    code: 'ZA',
    name: 'South Africa',
    defaultCurrency: 'ZAR',
    defaultLocale: 'en-ZA',
    defaultTimeZone: 'Africa/Johannesburg',
    defaultFiscalStartMonth: 3,
    defaultFiscalStartDay: 1,
    countryPackCode: 'GENERIC',
    countryPackVersion: GENERIC_PACK_VERSION,
    suggestedTaxRate: 15,
    taxIdentifierLabel: 'VAT number',
  },
  {
    code: 'GB',
    name: 'United Kingdom',
    defaultCurrency: 'GBP',
    defaultLocale: 'en-GB',
    defaultTimeZone: 'Europe/London',
    defaultFiscalStartMonth: 4,
    defaultFiscalStartDay: 1,
    countryPackCode: 'GENERIC',
    countryPackVersion: GENERIC_PACK_VERSION,
    suggestedTaxRate: 20,
    taxIdentifierLabel: 'VAT registration number',
  },
  {
    code: 'IE',
    name: 'Ireland',
    defaultCurrency: 'EUR',
    defaultLocale: 'en-IE',
    defaultTimeZone: 'Europe/Dublin',
    defaultFiscalStartMonth: 1,
    defaultFiscalStartDay: 1,
    countryPackCode: 'GENERIC',
    countryPackVersion: GENERIC_PACK_VERSION,
    suggestedTaxRate: 23,
    taxIdentifierLabel: 'VAT number',
  },
  {
    code: 'US',
    name: 'United States',
    defaultCurrency: 'USD',
    defaultLocale: 'en-US',
    defaultTimeZone: 'America/New_York',
    defaultFiscalStartMonth: 1,
    defaultFiscalStartDay: 1,
    countryPackCode: 'GENERIC',
    countryPackVersion: GENERIC_PACK_VERSION,
    suggestedTaxRate: 0,
    taxIdentifierLabel: 'EIN',
  },
  {
    code: 'CA',
    name: 'Canada',
    defaultCurrency: 'CAD',
    defaultLocale: 'en-CA',
    defaultTimeZone: 'America/Toronto',
    defaultFiscalStartMonth: 1,
    defaultFiscalStartDay: 1,
    countryPackCode: 'GENERIC',
    countryPackVersion: GENERIC_PACK_VERSION,
    suggestedTaxRate: 5,
    taxIdentifierLabel: 'GST/HST number',
  },
  {
    code: 'AE',
    name: 'United Arab Emirates',
    defaultCurrency: 'AED',
    defaultLocale: 'en-AE',
    defaultTimeZone: 'Asia/Dubai',
    defaultFiscalStartMonth: 1,
    defaultFiscalStartDay: 1,
    countryPackCode: 'GENERIC',
    countryPackVersion: GENERIC_PACK_VERSION,
    suggestedTaxRate: 5,
    taxIdentifierLabel: 'TRN',
  },
  {
    code: 'IN',
    name: 'India',
    defaultCurrency: 'INR',
    defaultLocale: 'en-IN',
    defaultTimeZone: 'Asia/Kolkata',
    defaultFiscalStartMonth: 4,
    defaultFiscalStartDay: 1,
    countryPackCode: 'GENERIC',
    countryPackVersion: GENERIC_PACK_VERSION,
    suggestedTaxRate: 18,
    taxIdentifierLabel: 'GSTIN',
  },
  {
    code: 'SG',
    name: 'Singapore',
    defaultCurrency: 'SGD',
    defaultLocale: 'en-SG',
    defaultTimeZone: 'Asia/Singapore',
    defaultFiscalStartMonth: 1,
    defaultFiscalStartDay: 1,
    countryPackCode: 'GENERIC',
    countryPackVersion: GENERIC_PACK_VERSION,
    suggestedTaxRate: 9,
    taxIdentifierLabel: 'GST registration number',
  },
  {
    code: 'AU',
    name: 'Australia',
    defaultCurrency: 'AUD',
    defaultLocale: 'en-AU',
    defaultTimeZone: 'Australia/Sydney',
    defaultFiscalStartMonth: 7,
    defaultFiscalStartDay: 1,
    countryPackCode: 'GENERIC',
    countryPackVersion: GENERIC_PACK_VERSION,
    suggestedTaxRate: 10,
    taxIdentifierLabel: 'ABN',
  },
  {
    code: 'NZ',
    name: 'New Zealand',
    defaultCurrency: 'NZD',
    defaultLocale: 'en-NZ',
    defaultTimeZone: 'Pacific/Auckland',
    defaultFiscalStartMonth: 4,
    defaultFiscalStartDay: 1,
    countryPackCode: 'GENERIC',
    countryPackVersion: GENERIC_PACK_VERSION,
    suggestedTaxRate: 15,
    taxIdentifierLabel: 'GST number',
  },
]);

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

export const timeZones: readonly string[] = Object.freeze([
  'Africa/Accra',
  'Africa/Dar_es_Salaam',
  'Africa/Johannesburg',
  'Africa/Kampala',
  'Africa/Kigali',
  'Africa/Lagos',
  'Africa/Nairobi',
  'America/Chicago',
  'America/Los_Angeles',
  'America/New_York',
  'America/Toronto',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Australia/Sydney',
  'Europe/Dublin',
  'Europe/London',
  'Pacific/Auckland',
  'UTC',
]);

export const locales: readonly { code: string; name: string }[] = Object.freeze([
  { code: 'en-AE', name: 'English (United Arab Emirates)' },
  { code: 'en-AU', name: 'English (Australia)' },
  { code: 'en-CA', name: 'English (Canada)' },
  { code: 'en-GB', name: 'English (United Kingdom)' },
  { code: 'en-GH', name: 'English (Ghana)' },
  { code: 'en-IE', name: 'English (Ireland)' },
  { code: 'en-IN', name: 'English (India)' },
  { code: 'en-KE', name: 'English (Kenya)' },
  { code: 'en-NG', name: 'English (Nigeria)' },
  { code: 'en-NZ', name: 'English (New Zealand)' },
  { code: 'en-RW', name: 'English (Rwanda)' },
  { code: 'en-SG', name: 'English (Singapore)' },
  { code: 'en-TZ', name: 'English (Tanzania)' },
  { code: 'en-UG', name: 'English (Uganda)' },
  { code: 'en-US', name: 'English (United States)' },
  { code: 'en-ZA', name: 'English (South Africa)' },
  { code: 'fr-RW', name: 'French (Rwanda)' },
  { code: 'sw-KE', name: 'Kiswahili (Kenya)' },
]);

export const chartTemplates: readonly { code: string; name: string; description: string }[] =
  Object.freeze([
    {
      code: 'general-business',
      name: 'General business',
      description: 'Balanced starter accounts for trading and service businesses.',
    },
    {
      code: 'retail',
      name: 'Retail and distribution',
      description: 'Adds cost-of-sales and stock-adjustment accounts for goods sellers.',
    },
    {
      code: 'services',
      name: 'Professional services',
      description: 'Emphasises fee income, billable costs, and staff-related expenses.',
    },
    {
      code: 'nonprofit',
      name: 'Nonprofit and grants',
      description: 'Separates restricted funds, grants, and programme expenditure.',
    },
  ]);

export const businessTypes: readonly { code: string; name: string }[] = Object.freeze([
  { code: 'SOLE_PROPRIETOR', name: 'Sole proprietor' },
  { code: 'PARTNERSHIP', name: 'Partnership' },
  { code: 'LIMITED_COMPANY', name: 'Limited company' },
  { code: 'NONPROFIT', name: 'Nonprofit or NGO' },
  { code: 'COOPERATIVE', name: 'Cooperative' },
  { code: 'OTHER', name: 'Other' },
]);

const countriesByCode = new Map(countries.map((country) => [country.code, country]));
const packsByCode = new Map(countryPacks.map((pack) => [pack.code, pack]));
const currencyCodes = new Set(currencies.map((currency) => currency.code));
const timeZoneSet = new Set(timeZones);
const localeCodes = new Set(locales.map((locale) => locale.code));
const chartTemplateCodes = new Set(chartTemplates.map((template) => template.code));

export function findCountry(code: string): CountryDefinition | undefined {
  return countriesByCode.get(code.toUpperCase());
}

export function resolveCountryPack(code: string | null | undefined): CountryPackDefinition {
  if (!code) return packsByCode.get('GENERIC')!;
  return packsByCode.get(code.toUpperCase()) ?? packsByCode.get('GENERIC')!;
}

export function findCurrency(code: string): CurrencyDefinition | undefined {
  return currencies.find((currency) => currency.code === code.toUpperCase());
}

export function isSupportedCurrency(code: string): boolean {
  return currencyCodes.has(code.toUpperCase());
}

export function isSupportedTimeZone(value: string): boolean {
  return timeZoneSet.has(value);
}

export function isSupportedLocale(code: string): boolean {
  return localeCodes.has(code);
}

export function isSupportedChartTemplate(code: string): boolean {
  return chartTemplateCodes.has(code);
}

/** Days available for a fiscal-year start month, ignoring leap years so the value stays stable. */
export function maxFiscalStartDay(month: number): number {
  const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return lengths[month - 1] ?? 31;
}

export const referenceData = Object.freeze({
  countries,
  countryPacks,
  currencies,
  timeZones,
  locales,
  chartTemplates,
  businessTypes,
  accountingBases: [
    {
      code: 'ACCRUAL',
      name: 'Accrual',
      description: 'Record income and costs when they are earned or incurred.',
    },
    {
      code: 'CASH',
      name: 'Cash',
      description: 'Record income and costs when money moves.',
    },
  ],
  taxTreatments: [
    { code: 'EXCLUSIVE', name: 'Tax exclusive', description: 'Amounts entered exclude tax.' },
    {
      code: 'INCLUSIVE',
      name: 'Tax inclusive',
      description: 'Amounts entered already include tax.',
    },
  ],
  numberingResets: [
    { code: 'NEVER', name: 'Never reset' },
    { code: 'ANNUAL', name: 'Reset every fiscal year' },
    { code: 'MONTHLY', name: 'Reset every month' },
  ],
});
