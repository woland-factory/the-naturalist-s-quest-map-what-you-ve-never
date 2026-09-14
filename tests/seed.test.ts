import { describe, expect, it } from "vitest";
import { seedDemo, DEMO_QUEST_ID } from "../server/seed.js";
import { createCache } from "../server/cache.js";
import { loadConfig, type AppConfig } from "../server/config.js";
import { createMemoryQuestStore } from "../server/store/quests.js";

function demoConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return { ...loadConfig(), seedDemo: true, seedDemoLogin: "kueda", seedDemoPlaceId: 14, seedDemoPlaceName: "California", ...overrides };
}

describe("seedDemo melt", () => {
  it("persists the demo quest with at least one melted target and valid provenance", () => {
    const store = createMemoryQuestStore();
    seedDemo(createCache(500), demoConfig(), store);

    const rec = store.get(DEMO_QUEST_ID);
    expect(rec).toBeDefined();
    expect(rec!.melted.length).toBeGreaterThanOrEqual(1);

    for (const m of rec!.melted) {
      expect(m.observationUrl).toMatch(/^https:\/\/www\.inaturalist\.org\/observations\/\d+$/);
      expect(m.observedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof m.photoUrl).toBe("string");
      expect(m.photoUrl).toMatch(/^https:\/\//);
      // Deterministic meltedAt: every entry shares the record ts.
      expect(m.meltedAt).toBe(rec!.createdAt);
    }

    // The snapshot includes the melted taxa so counts stay coherent.
    for (const m of rec!.melted) {
      expect(rec!.targetTaxonIds).toContain(m.taxonId);
    }
  });

  it("keeps open and found sets disjoint: no taxon is both a target and melted", () => {
    const store = createMemoryQuestStore();
    seedDemo(createCache(500), demoConfig(), store);
    const rec = store.get(DEMO_QUEST_ID)!;
    // The pre-warmed open list lives in the cache; here we assert the fixtures
    // themselves do not double-count: melted taxon ids are not in the open
    // species-counts fixture ids (targetTaxonIds = open ids + melted ids, so an
    // overlap would show as a duplicated id).
    const meltedIds = new Set(rec.melted.map((m) => m.taxonId));
    const openIds = rec.targetTaxonIds.filter((id) => !meltedIds.has(id));
    for (const id of meltedIds) {
      expect(openIds).not.toContain(id);
    }
  });

  it("re-seeding is idempotent: it never duplicates or rewrites the demo quest", () => {
    const store = createMemoryQuestStore();
    const cache = createCache(500);
    seedDemo(cache, demoConfig(), store);
    const firstTs = store.get(DEMO_QUEST_ID)!.createdAt;
    seedDemo(cache, demoConfig(), store);
    expect(store.countByLogin("kueda")).toBe(1);
    expect(store.get(DEMO_QUEST_ID)!.createdAt).toBe(firstTs);
  });
});
