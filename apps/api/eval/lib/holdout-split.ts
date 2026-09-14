/**
 * Frozen, deterministic dev/holdout split: a case's split assignment depends only on its own id
 * string (djb2 hash mod 10), never on generation order or run count. Regenerating the corpus with
 * more cases never reshuffles an existing id's assignment -- an id already scored as holdout stays
 * holdout for as long as that id exists, which is the entire point of a "frozen" holdout: nothing
 * gets to move into the dev/tuning bucket after the fact.
 */
export type SplitBucket = 'dev' | 'holdout';

function djb2(value: string): number {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return hash >>> 0;
}

/** ~70% dev, ~30% holdout. */
export function splitFor(id: string): SplitBucket {
  return djb2(id) % 10 < 7 ? 'dev' : 'holdout';
}
