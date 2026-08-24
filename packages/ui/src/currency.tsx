'use client';

import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes } from 'react';

import { cn } from './utils';

export interface CurrencyOption {
  readonly code: string;
  readonly name: string;
  readonly symbol: string;
  readonly minorUnits?: number;
  readonly disabled?: boolean;
}

export interface CurrencySelectProps extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  'children'
> {
  currencies: readonly CurrencyOption[];
  placeholder?: string;
}

export const CurrencySelect = forwardRef<HTMLSelectElement, CurrencySelectProps>(
  function CurrencySelect({ className, currencies, placeholder, ...props }, ref) {
    return (
      <select className={cn('rb-select', 'rb-currency-select', className)} ref={ref} {...props}>
        {placeholder ? <option value="">{placeholder}</option> : null}
        {currencies.map((currency) => (
          <option key={currency.code} value={currency.code} disabled={currency.disabled}>
            {currency.code} — {currency.name} ({currency.symbol})
          </option>
        ))}
      </select>
    );
  },
);

export interface MoneyInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  currency: string;
  symbol?: string;
  minorUnits?: number;
}

/**
 * Currency-aware decimal entry chrome. It deliberately returns the user's decimal string unchanged;
 * callers convert to integer minor units at their domain boundary rather than through JS floats.
 */
export const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  { className, currency, symbol, minorUnits = 2, inputMode = 'decimal', ...props },
  ref,
) {
  const precisionHint = minorUnits === 0 ? 'whole units' : `${minorUnits} decimal places`;
  return (
    <span className={cn('rb-money-input', className)}>
      <span className="rb-money-input__symbol" aria-hidden="true">
        {symbol ?? currency}
      </span>
      <input
        {...props}
        ref={ref}
        type="text"
        inputMode={inputMode}
        className="rb-input rb-money-input__control"
        aria-describedby={props['aria-describedby']}
        data-currency={currency}
        data-precision={minorUnits}
      />
      <span className="rb-money-input__currency" title={`Amounts use ${precisionHint}`}>
        {currency}
      </span>
    </span>
  );
});
