export type JournalLineAmount = Readonly<{
  debitMinor: bigint;
  creditMinor: bigint;
}>;

export function isBalancedJournal(lines: readonly JournalLineAmount[]): boolean {
  if (lines.length < 2) return false;

  const totals = lines.reduce(
    (value, line) => ({
      debitMinor: value.debitMinor + line.debitMinor,
      creditMinor: value.creditMinor + line.creditMinor,
    }),
    { debitMinor: 0n, creditMinor: 0n },
  );

  return totals.debitMinor > 0n && totals.debitMinor === totals.creditMinor;
}
