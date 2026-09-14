import type { AppConfig } from "./config.js";
import type { Cache } from "./cache.js";
import { targetsKey } from "./cache.js";
import type { INatClient } from "./inat/client.js";
import { blendTargets } from "./inat/ranking.js";
import type { Target } from "./inat/types.js";

// The ranking core, in one module so EPIC 2 can re-run it on a saved quest
// without a rewrite. It fetches the frequency ranking once, enriches the
// head with distinct-observer counts within a time budget, blends, and
// caches the whole blended result so pagination and repeat views are pure
// cache reads that never re-hit iNat.

export interface BuiltTargets {
  totalAvailable: number; // iNat total_results (the 10k+ figure), for the "showing N of many" line
  totalTargets: number; // capped count actually held
  targets: Target[];
}

export const RANK_BASIS = "frequency+observers";

// The one-line, honest statement of what the ranking means. Kept verbatim
// from the spec; swept for banned copy. Lives here (not in a route) so the
// quest route imports it after the old targets route is removed.
export const RANKING_NOTE =
  "Ranked by how often people record each species here this month, and by how many different people find it. It's a guide, not a guarantee.";

/**
 * The live season is always "now". A quest stores no month; its ranking
 * month is resolved every time it is created, opened, or listed-for-build,
 * so a quest re-ranks by itself as the calendar turns. Resolved in UTC so
 * the result is deterministic regardless of server timezone.
 */
export function resolveSeasonMonth(now: () => number = Date.now): number {
  return new Date(now()).getUTCMonth() + 1;
}

export interface TargetsDeps {
  client: INatClient;
  cache: Cache;
  config: AppConfig;
  now?: () => number;
}

/**
 * Build (or read from cache) the fully blended, capped target list for a
 * quest. Cost of a cold, novel quest: one species_counts call plus up to
 * OBSERVER_ENRICH_TOP_K observer calls. Every repeat is a pure cache hit.
 */
export async function buildTargets(
  deps: TargetsDeps,
  params: { login: string; placeId: number; month: number; taxonRootId?: number },
): Promise<BuiltTargets> {
  const { client, cache, config } = deps;
  const now = deps.now ?? Date.now;
  const key = targetsKey(params.placeId, params.month, params.taxonRootId, params.login);

  const cached = cache.get<BuiltTargets>(key);
  if (cached !== undefined) return cached;

  // 1. Frequency ranking in one call. Never fetch the full 10k+ tail: ask
  //    for exactly MAX_TARGETS, capped by iNat's per_page ceiling of 500.
  const perPage = Math.min(config.maxTargets, 500);
  const counts = await client.speciesCounts({
    login: params.login,
    placeId: params.placeId,
    month: params.month,
    taxonRootId: params.taxonRootId,
    perPage,
    page: 1,
  });

  const capped = counts.results.slice(0, config.maxTargets);

  // 2. Enrich the head with distinct-observer counts, within a time budget.
  //    On any error or once the budget is spent, stop enriching and leave
  //    the rest frequency-only. Never fail the whole query over enrichment.
  const observersByTaxon = new Map<number, number | null>();
  const headSize = Math.min(config.observerEnrichTopK, capped.length);
  const startedAt = now();
  for (let i = 0; i < headSize; i++) {
    if (now() - startedAt >= config.requestEnrichBudgetMs) break;
    const c = capped[i];
    try {
      const observers = await client.distinctObservers({
        taxonId: c.taxon.id,
        placeId: params.placeId,
        month: params.month,
      });
      observersByTaxon.set(c.taxon.id, observers);
    } catch {
      // enrichment is best-effort; stop and keep what we have
      break;
    }
  }

  // 3. Blend and cache the whole result so pagination is one cache entry.
  const targets = blendTargets(capped, observersByTaxon, config.observerEnrichTopK);
  const built: BuiltTargets = {
    totalAvailable: counts.total_results,
    totalTargets: targets.length,
    targets,
  };
  cache.set(key, built, config.targetsTtlSeconds);
  return built;
}

export function paginate(built: BuiltTargets, page: number, perPage: number): Target[] {
  const start = (page - 1) * perPage;
  return built.targets.slice(start, start + perPage);
}
