import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { AppConfig } from "./config.js";
import type { Cache } from "./cache.js";
import { targetsKey, userKey } from "./cache.js";
import { blendTargets } from "./inat/ranking.js";
import type { BuiltTargets } from "./targets.js";
import type { SpeciesCountsResponse, UserProfile } from "./inat/types.js";

// SEED_DEMO pre-warms the cache for one known-good demo quest from bundled
// fixtures, so a fresh staging visitor sees a populated, non-empty ranked
// list within a minute even if iNaturalist is slow or down. Pre-warming
// from a fixture (not a live call) is what guarantees the demo never shows
// zero results.
//
// Fixture provenance: server/fixtures/*.json are representative snapshots
// of PUBLIC iNaturalist data (species_counts and observers payloads for a
// California quest). They hold only public species names, counts, photo
// URLs, and a public username. No private data, no secret, no PII.

const here = dirname(fileURLToPath(import.meta.url));

function readFixture<T>(name: string): T {
  const raw = readFileSync(join(here, "fixtures", name), "utf8");
  return JSON.parse(raw) as T;
}

export function seedDemo(cache: Cache, config: AppConfig): void {
  const counts = readFixture<SpeciesCountsResponse>("demo-species-counts.json");
  const observersRaw = readFixture<Record<string, number>>("demo-observers.json");

  const observersByTaxon = new Map<number, number | null>();
  for (const [taxonId, value] of Object.entries(observersRaw)) {
    observersByTaxon.set(Number(taxonId), value);
  }

  const capped = counts.results.slice(0, config.maxTargets);
  const targets = blendTargets(capped, observersByTaxon, config.observerEnrichTopK);
  const built: BuiltTargets = {
    totalAvailable: counts.total_results,
    totalTargets: targets.length,
    targets,
  };

  cache.set(
    targetsKey(config.seedDemoPlaceId, config.seedDemoMonth, undefined, config.seedDemoLogin),
    built,
    config.targetsTtlSeconds,
  );

  // Pre-warm the demo user so POST /api/targets validates without any
  // upstream call, keeping the whole demo path offline and instant.
  const profile: UserProfile = {
    id: 1,
    login: config.seedDemoLogin,
    name: config.seedDemoLogin,
    iconUrl: null,
  };
  cache.set(userKey(config.seedDemoLogin), profile, config.userTtlSeconds);
}
