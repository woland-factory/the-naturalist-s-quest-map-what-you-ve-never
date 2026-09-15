import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { AppConfig } from "./config.js";
import type { Cache } from "./cache.js";
import { histogramKey, targetsKey, userKey } from "./cache.js";
import { blendTargets } from "./inat/ranking.js";
import { resolveSeasonMonth, type BuiltTargets } from "./targets.js";
import type { MeltedTarget, QuestStore } from "./store/quests.js";
import type { BBox, SpeciesCountsResponse, UserProfile } from "./inat/types.js";

// SEED_DEMO pre-warms the cache for one known-good demo quest from bundled
// fixtures AND persists that quest, so a fresh staging visitor lands on a
// saved quest and can open it to a populated, non-empty ranked list within a
// minute even if iNaturalist is slow or down. Pre-warming from a fixture
// (not a live call) is what guarantees the demo never shows zero results.
//
// Fixture provenance: server/fixtures/*.json are representative snapshots
// of PUBLIC iNaturalist data (species_counts and observers payloads for a
// California quest). They hold only public species names, counts, photo
// URLs, and a public username. No private data, no secret, no PII.
// demo-melted.json holds real PUBLIC research-grade observations by the demo
// user at this place (public observation ids, urls, photos and dates), so the
// staging demo shows a target that has already checked itself off, baked from
// a fixture rather than a live poll. demo-histograms.json holds real PUBLIC
// week-of-year histogram snapshots (observations/histogram, verifiable=true)
// for the demo taxa at this place: aggregate counts only, no PII.

const here = dirname(fileURLToPath(import.meta.url));

// A stable, UUID-shaped id so re-seeding upserts the same demo quest and can
// never create a duplicate. It also passes the quest route's UUID validation.
export const DEMO_QUEST_ID = "00000000-0000-4000-8000-000000000001";

// California's extent, so the demo map frames the right region without a live
// place lookup on boot.
const CALIFORNIA_BBOX: BBox = { swLat: 32.53, swLng: -124.48, neLat: 42.01, neLng: -114.13 };

function readFixture<T>(name: string): T {
  const raw = readFileSync(join(here, "fixtures", name), "utf8");
  return JSON.parse(raw) as T;
}

export function seedDemo(cache: Cache, config: AppConfig, store: QuestStore): void {
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

  // Key the pre-warm to the CURRENT season month, which is exactly what
  // reopening the demo quest resolves, so opening it is always a cache hit
  // and never fans out to iNaturalist.
  const month = resolveSeasonMonth();
  cache.set(
    targetsKey(config.seedDemoPlaceId, month, undefined, config.seedDemoLogin),
    built,
    config.targetsTtlSeconds,
  );

  // Pre-warm week-of-year histograms for the demo's top targets from the
  // fixture (public iNaturalist snapshots), so the seasonality indicator
  // shows on staging without a single live histogram call.
  const histograms = readFixture<Record<string, number[]>>("demo-histograms.json");
  for (const target of targets.slice(0, config.seasonalityTopN)) {
    const weeks = histograms[String(target.taxonId)];
    if (weeks) {
      cache.set(histogramKey(target.taxonId, config.seedDemoPlaceId), weeks, config.seasonalityTtlSeconds);
    }
  }

  // Pre-warm the demo user so creating/opening validates without any upstream
  // call, keeping the whole demo path offline and instant.
  const profile: UserProfile = {
    id: 1,
    login: config.seedDemoLogin,
    name: config.seedDemoLogin,
    iconUrl: null,
  };
  cache.set(userKey(config.seedDemoLogin), profile, config.userTtlSeconds);

  // Persist the demo quest idempotently. If it already exists (a prior boot,
  // now loaded from the volume) leave it in place so restarts never duplicate.
  if (!store.get(DEMO_QUEST_ID)) {
    const ts = Date.now();
    // Bake the melted targets from the fixture with one stable meltedAt (the
    // record ts), so re-seeds are deterministic and the signature moment shows
    // on staging within a minute even if iNaturalist is slow or down.
    const meltedFixture = readFixture<MeltedTarget[]>("demo-melted.json");
    const melted: MeltedTarget[] = meltedFixture.map((m) => ({ ...m, meltedAt: ts }));
    // The snapshot the melt poll would intersect: the open taxa plus the
    // already-melted taxa, so counts stay coherent (a melted taxon is not in
    // the open species-counts fixture, so open and found never overlap).
    const openTaxonIds = built.targets.map((t) => t.taxonId);
    const targetTaxonIds = [...openTaxonIds, ...melted.map((m) => m.taxonId)];
    store.create({
      id: DEMO_QUEST_ID,
      loginLower: config.seedDemoLogin.toLowerCase(),
      loginDisplay: config.seedDemoLogin,
      inatUserId: profile.id,
      placeId: config.seedDemoPlaceId,
      placeName: config.seedDemoPlaceName,
      placeBbox: CALIFORNIA_BBOX,
      taxonRootId: null,
      createdAt: ts,
      lastRefreshedAt: ts,
      lastSeasonMonth: month,
      lastTargetCount: built.totalTargets,
      lastTotalAvailable: built.totalAvailable,
      targetTaxonIds,
      melted,
      lastMeltPolledAt: ts,
    });
  }
}
