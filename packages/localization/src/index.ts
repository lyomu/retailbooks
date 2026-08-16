export type CountryPackIdentity = Readonly<{
  code: string;
  version: string;
  defaultCurrency: string;
  defaultLocale: string;
  defaultTimeZone: string;
}>;

export const kenyaCountryPack: CountryPackIdentity = Object.freeze({
  code: 'KE',
  version: '2026.1-draft',
  defaultCurrency: 'KES',
  defaultLocale: 'en-KE',
  defaultTimeZone: 'Africa/Nairobi',
});
