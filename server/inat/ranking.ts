import type { SpeciesCount, Target } from "./types.js";

// Ranking is a pure function of its inputs so it is fully unit-testable
// with fixtures and behaves identically on a cache replay.
//
// iNat gives observation frequency (`count`) cheaply for every species but
// exposes distinct-observer counts only per species. Fetching observers for
// all 10k+ species under a 1 req/s limit is infeasible, so we blend only
// the head: the top-K by frequency are enriched with distinct-observer
// counts and re-sorted by a blended score, because that is where observer
// diversity actually reorders what a user acts on. The tail keeps frequency
// order and carries distinctObservers: null.

export const WEIGHT_FREQUENCY = 0.6;
export const WEIGHT_OBSERVERS = 0.4;

// log-then-min-max over a set of values, mapped to [0, 1]. Using log damps
// the long tail of raw counts so one runaway species does not flatten the
// rest. When every value is equal the normalized score is 1 for all.
function logMinMax(values: number[]): (v: number) => number {
  const logs = values.map((v) => Math.log(v + 1));
  const min = Math.min(...logs);
  const max = Math.max(...logs);
  const span = max - min;
  return (v: number) => {
    if (span <= 0) return 1;
    return (Math.log(v + 1) - min) / span;
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Blend frequency with distinct-observer counts for the enriched head.
 *
 * @param counts  species counts in frequency-desc order, already capped to MAX_TARGETS.
 * @param observersByTaxon  distinct-observer count per enriched taxon id (null/absent = not enriched).
 * @param enrichTopK  how many leading targets we attempted to enrich.
 */
export function blendTargets(
  counts: SpeciesCount[],
  observersByTaxon: Map<number, number | null>,
  enrichTopK: number,
): Target[] {
  if (counts.length === 0) return [];

  const freqNorm = logMinMax(counts.map((c) => c.count));

  const headSize = Math.min(enrichTopK, counts.length);
  const headSlice = counts.slice(0, headSize);

  // Only the head entries that actually came back with an observer count get
  // the blended treatment; the rest stay frequency-ranked.
  const enriched = headSlice.filter((c) => {
    const o = observersByTaxon.get(c.taxon.id);
    return typeof o === "number";
  });
  const obsNorm =
    enriched.length > 0
      ? logMinMax(enriched.map((c) => observersByTaxon.get(c.taxon.id) as number))
      : () => 0;

  const toTarget = (c: SpeciesCount, distinctObservers: number | null, rankScore: number): Target => ({
    taxonId: c.taxon.id,
    scientificName: c.taxon.name,
    commonName: c.taxon.preferred_common_name || c.taxon.name,
    photoUrl: pickPhoto(c),
    obsCount: c.count,
    distinctObservers,
    rankScore: round(rankScore),
  });

  const head: Target[] = headSlice.map((c) => {
    const o = observersByTaxon.get(c.taxon.id);
    if (typeof o === "number") {
      const score = WEIGHT_FREQUENCY * freqNorm(c.count) + WEIGHT_OBSERVERS * obsNorm(o);
      return toTarget(c, o, score);
    }
    // Head target we could not enrich: frequency-only, observers unknown.
    return toTarget(c, null, freqNorm(c.count));
  });

  // Re-sort the head by blended score. Ties fall back to raw count so the
  // order is fully deterministic.
  head.sort((a, b) => b.rankScore - a.rankScore || b.obsCount - a.obsCount || a.taxonId - b.taxonId);

  const tail: Target[] = counts.slice(headSize).map((c) => toTarget(c, null, freqNorm(c.count)));

  return [...head, ...tail];
}

function pickPhoto(c: SpeciesCount): string | null {
  const p = c.taxon.default_photo;
  if (!p) return null;
  return p.medium_url || p.square_url || p.url || null;
}
