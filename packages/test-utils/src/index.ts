export function fixedClock(isoTimestamp = '2026-08-16T00:00:00.000Z'): () => Date {
  return () => new Date(isoTimestamp);
}
