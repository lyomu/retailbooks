export type NormalBalance = 'DEBIT' | 'CREDIT';

export type AccountType =
  | 'ASSET'
  | 'LIABILITY'
  | 'EQUITY'
  | 'REVENUE'
  | 'EXPENSE'
  | 'COST_OF_SALES'
  | 'OTHER_INCOME'
  | 'OTHER_EXPENSE';

export type JournalLineAmount = Readonly<{
  debitMinor: bigint;
  creditMinor: bigint;
}>;

export type JournalLineInput = JournalLineAmount &
  Readonly<{
    accountId: string;
    description?: string | null;
  }>;

export type TrialBalanceLine = Readonly<{
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  normalBalance: NormalBalance;
  debitMinor: bigint;
  creditMinor: bigint;
}>;

export function normalBalanceForType(type: AccountType): NormalBalance {
  switch (type) {
    case 'ASSET':
    case 'EXPENSE':
    case 'COST_OF_SALES':
    case 'OTHER_EXPENSE':
      return 'DEBIT';
    case 'LIABILITY':
    case 'EQUITY':
    case 'REVENUE':
    case 'OTHER_INCOME':
      return 'CREDIT';
  }
}

export function isBalancedJournal(lines: readonly JournalLineAmount[]): boolean {
  if (lines.length < 2) return false;

  const totals = journalTotals(lines);
  return totals.debitMinor > 0n && totals.debitMinor === totals.creditMinor;
}

export function journalTotals(lines: readonly JournalLineAmount[]): JournalLineAmount {
  return lines.reduce(
    (value, line) => ({
      debitMinor: value.debitMinor + line.debitMinor,
      creditMinor: value.creditMinor + line.creditMinor,
    }),
    { debitMinor: 0n, creditMinor: 0n },
  );
}

export function validateJournalLines(lines: readonly JournalLineInput[]): string[] {
  const errors: string[] = [];
  if (lines.length < 2) errors.push('A journal needs at least two lines.');

  lines.forEach((line, index) => {
    const label = `Line ${index + 1}`;
    if (!line.accountId) errors.push(`${label} needs an account.`);
    if (line.debitMinor < 0n || line.creditMinor < 0n) {
      errors.push(`${label} cannot have negative amounts.`);
    }
    if (line.debitMinor === 0n && line.creditMinor === 0n) {
      errors.push(`${label} needs a debit or credit amount.`);
    }
    if (line.debitMinor > 0n && line.creditMinor > 0n) {
      errors.push(`${label} cannot have both debit and credit.`);
    }
  });

  const totals = journalTotals(lines);
  if (totals.debitMinor === 0n || totals.creditMinor === 0n) {
    errors.push('Journal totals must be greater than zero.');
  }
  if (totals.debitMinor !== totals.creditMinor) {
    errors.push('Journal debits and credits must balance.');
  }

  return [...new Set(errors)];
}

export function reverseJournalLines(lines: readonly JournalLineInput[]): JournalLineInput[] {
  return lines.map((line) => ({
    accountId: line.accountId,
    description: line.description,
    debitMinor: line.creditMinor,
    creditMinor: line.debitMinor,
  }));
}

export function signedMovement(
  normalBalance: NormalBalance,
  debitMinor: bigint,
  creditMinor: bigint,
): bigint {
  return normalBalance === 'DEBIT' ? debitMinor - creditMinor : creditMinor - debitMinor;
}

export function trialBalanceLine(
  input: Readonly<{
    accountId: string;
    accountCode: string;
    accountName: string;
    accountType: AccountType;
    normalBalance: NormalBalance;
    movementMinor: bigint;
  }>,
): TrialBalanceLine {
  const absolute = input.movementMinor < 0n ? -input.movementMinor : input.movementMinor;
  const onNormalSide = input.movementMinor >= 0n;
  const debitMinor =
    input.normalBalance === 'DEBIT' ? (onNormalSide ? absolute : 0n) : onNormalSide ? 0n : absolute;
  const creditMinor =
    input.normalBalance === 'CREDIT'
      ? onNormalSide
        ? absolute
        : 0n
      : onNormalSide
        ? 0n
        : absolute;

  return {
    accountId: input.accountId,
    accountCode: input.accountCode,
    accountName: input.accountName,
    accountType: input.accountType,
    normalBalance: input.normalBalance,
    debitMinor,
    creditMinor,
  };
}

export function assertMinorUnitString(value: string): bigint {
  if (!/^-?\d+$/.test(value)) {
    throw new RangeError('Amount must be an integer minor-unit string.');
  }
  return BigInt(value);
}

/** Scale applied to a decimal rate-percent string so all tax math stays integer-only. */
const RATE_SCALE = 10_000n;
const RATE_FRACTION_DENOMINATOR = 1_000_000n;

/**
 * Parses a decimal rate-percent string (up to 4 decimal places, matching the Decimal(7,4) column
 * precision) into an integer scaled by 10,000 so downstream tax math never touches floating point.
 */
export function parseRatePercentToScaled(ratePercent: string): bigint {
  if (!/^\d+(\.\d{1,4})?$/.test(ratePercent)) {
    throw new RangeError('Rate percent must be a non-negative decimal string with up to 4 places.');
  }
  const [whole = '0', fraction = ''] = ratePercent.split('.');
  const paddedFraction = fraction.padEnd(4, '0');
  return BigInt(whole) * RATE_SCALE + BigInt(paddedFraction);
}

/**
 * Integer division that rounds half away from zero. Doubling both operands before dividing avoids
 * the parity bias a naive `(abs + denominator/2) / denominator` has when `denominator` is odd.
 */
export function roundHalfUpDivide(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError('Denominator must be positive.');
  const sign = numerator < 0n ? -1n : 1n;
  const absNumerator = numerator < 0n ? -numerator : numerator;
  return sign * ((absNumerator * 2n + denominator) / (denominator * 2n));
}

/** Tax-exclusive calculation: base amount does not include tax, so tax is added on top. */
export function taxAmountExclusive(baseMinor: bigint, rateScaled: bigint): bigint {
  return roundHalfUpDivide(baseMinor * rateScaled, RATE_FRACTION_DENOMINATOR);
}

/**
 * Tax-inclusive calculation: total already includes tax. The base is rounded first and tax is the
 * residual (`total - base`), so the two components always reconstruct the original total exactly.
 */
export function splitInclusiveAmount(
  totalMinor: bigint,
  rateScaled: bigint,
): { baseMinor: bigint; taxMinor: bigint } {
  const baseMinor = roundHalfUpDivide(
    totalMinor * RATE_FRACTION_DENOMINATOR,
    RATE_FRACTION_DENOMINATOR + rateScaled,
  );
  return { baseMinor, taxMinor: totalMinor - baseMinor };
}
