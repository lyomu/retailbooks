import type { TaxTreatment } from '@prisma/client';

export interface StarterTaxCode {
  readonly code: string;
  readonly name: string;
  readonly treatment: TaxTreatment;
  readonly recoverable: boolean;
  readonly description?: string;
  /** Chart-of-accounts code for the output (sales) tax control account, if any. */
  readonly salesTaxAccountCode?: string;
  /** Chart-of-accounts code for the input (purchase) tax control account, if any. */
  readonly purchaseTaxAccountCode?: string;
}

const exclusive = 'EXCLUSIVE' satisfies TaxTreatment;

const kenyaTaxCodes: readonly StarterTaxCode[] = Object.freeze([
  {
    code: 'VAT-STD',
    name: 'Standard-rated VAT',
    treatment: exclusive,
    recoverable: true,
    description: 'Standard Kenyan VAT rate. Demonstration default, not a certified statutory rate.',
    salesTaxAccountCode: '2050',
    purchaseTaxAccountCode: '1400',
  },
  {
    code: 'VAT-ZERO',
    name: 'Zero-rated VAT',
    treatment: exclusive,
    recoverable: true,
    description: 'Zero-rated supplies. Input tax remains recoverable at 0% output tax.',
    salesTaxAccountCode: '2050',
    purchaseTaxAccountCode: '1400',
  },
  {
    code: 'VAT-EXEMPT',
    name: 'Exempt',
    treatment: exclusive,
    recoverable: false,
    description: 'Exempt supplies. No output tax charged and no input tax recovery.',
  },
]);

const genericTaxCodes: readonly StarterTaxCode[] = Object.freeze([
  {
    code: 'NO-TAX',
    name: 'No tax',
    treatment: exclusive,
    recoverable: false,
    description: 'Placeholder starter code for jurisdictions without a demonstration tax pack.',
  },
]);

const taxCodesByCountryPack: Readonly<Record<string, readonly StarterTaxCode[]>> = Object.freeze({
  KE: kenyaTaxCodes,
});

export function starterTaxCodesForCountryPack(countryPackCode: string): readonly StarterTaxCode[] {
  return taxCodesByCountryPack[countryPackCode] ?? genericTaxCodes;
}
