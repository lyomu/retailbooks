import { createHash } from 'node:crypto';

/** sha256 over account|date|direction|amount|normalized description|normalized reference, unique
 * per `financialAccountId` (see `BankTransaction`'s `@@unique([financialAccountId, fingerprint])`)
 * so a re-import of the same statement window deduplicates instead of double-posting. Normalizing
 * description/reference (trim + lowercase + collapse whitespace) means trivial re-export
 * whitespace/casing differences from the same bank don't produce a false new row. */
export function computeBankTransactionFingerprint(input: {
  financialAccountId: string;
  transactionDate: string;
  direction: 'INFLOW' | 'OUTFLOW';
  amountMinor: bigint;
  description: string;
  reference: string | null;
}): string {
  const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
  const parts = [
    input.financialAccountId,
    input.transactionDate,
    input.direction,
    input.amountMinor.toString(),
    normalize(input.description),
    normalize(input.reference ?? ''),
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}
