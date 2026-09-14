import { describe, expect, it, vi } from "vitest";
import { pollMelt, type MeltDeps } from "../server/melt.js";
import { createCache } from "../server/cache.js";
import { loadConfig } from "../server/config.js";
import { INatError, type ObservedTaxon } from "../server/inat/types.js";
import type { INatClient } from "../server/inat/client.js";
import type { MeltedTarget, QuestRecord } from "../server/store/quests.js";

function quest(overrides: Partial<QuestRecord> = {}): QuestRecord {
  const ts = 1_700_000_000_000;
  return {
    id: "11111111-1111-4111-8111-111111111111",
    loginLower: "kueda",
    loginDisplay: "Kueda",
    inatUserId: 1,
    placeId: 14,
    placeName: "California",
    placeBbox: null,
    taxonRootId: null,
    createdAt: ts,
    lastRefreshedAt: ts,
    lastSeasonMonth: 9,
    lastTargetCount: 30,
    lastTotalAvailable: 4210,
    targetTaxonIds: [],
    melted: [],
    lastMeltPolledAt: 0,
    ...overrides,
  };
}

function observed(taxonId: number, over: Partial<ObservedTaxon> = {}): ObservedTaxon {
  return {
    taxonId,
    scientificName: `Genus ${taxonId}`,
    commonName: `Creature ${taxonId}`,
    photoUrl: `https://x/${taxonId}/medium.jpg`,
    observationId: 1000 + taxonId,
    observationUrl: `https://www.inaturalist.org/observations/${1000 + taxonId}`,
    observedOn: "2026-09-03",
    ...over,
  };
}

function deps(observations: ObservedTaxon[] | Error, now = () => 5_000): MeltDeps {
  const recentConfirmedObservations = vi.fn(async () => {
    if (observations instanceof Error) throw observations;
    return observations;
  });
  const client = { recentConfirmedObservations } as unknown as INatClient;
  return { client, cache: createCache(50), config: loadConfig(), now };
}

describe("pollMelt", () => {
  it("melts a target the user has confirmed, with full provenance", async () => {
    const d = deps([observed(57665)]);
    const res = await pollMelt(d, quest({ targetTaxonIds: [57665, 111, 222] }));
    expect(res.newlyMelted).toHaveLength(1);
    const m = res.newlyMelted[0];
    expect(m).toMatchObject({
      taxonId: 57665,
      observationUrl: "https://www.inaturalist.org/observations/58665",
      observedOn: "2026-09-03",
      photoUrl: "https://x/57665/medium.jpg",
      meltedAt: 5_000,
    });
    expect(res.melted).toHaveLength(1);
  });

  it("never melts an observed taxon that is not in the target set", async () => {
    const d = deps([observed(999)]);
    const res = await pollMelt(d, quest({ targetTaxonIds: [57665] }));
    expect(res.newlyMelted).toEqual([]);
    expect(res.melted).toEqual([]);
  });

  it("is idempotent: an already-melted taxon is not duplicated and keeps its meltedAt", async () => {
    const existing: MeltedTarget = {
      taxonId: 57665,
      scientificName: "Cotinis mutabilis",
      commonName: "Figeater Beetle",
      photoUrl: "https://x/old.jpg",
      observationId: 1,
      observationUrl: "https://www.inaturalist.org/observations/1",
      observedOn: "2026-01-01",
      meltedAt: 42,
    };
    const d = deps([observed(57665)], () => 9_999);
    const res = await pollMelt(d, quest({ targetTaxonIds: [57665], melted: [existing] }));
    expect(res.newlyMelted).toEqual([]);
    expect(res.melted).toHaveLength(1);
    expect(res.melted[0].meltedAt).toBe(42); // stable, not rewritten
    expect(res.melted[0].photoUrl).toBe("https://x/old.jpg");
  });

  it("melts a taxon once even if it appears in multiple observations on the page", async () => {
    const d = deps([observed(57665, { observationId: 1 }), observed(57665, { observationId: 2 })]);
    const res = await pollMelt(d, quest({ targetTaxonIds: [57665] }));
    expect(res.newlyMelted).toHaveLength(1);
  });

  it("skips the upstream call entirely when the target snapshot is empty", async () => {
    const d = deps([observed(57665)]);
    const res = await pollMelt(d, quest({ targetTaxonIds: [] }));
    expect(res.newlyMelted).toEqual([]);
    expect(d.client.recentConfirmedObservations).not.toHaveBeenCalled();
  });

  it("is best-effort: on an adapter error it returns the existing melted set and does not throw", async () => {
    const existing: MeltedTarget = {
      taxonId: 1,
      scientificName: "x",
      commonName: "x",
      photoUrl: null,
      observationId: 1,
      observationUrl: "https://www.inaturalist.org/observations/1",
      observedOn: null,
      meltedAt: 7,
    };
    const warn = vi.fn();
    const d = { ...deps(new INatError("down", "network")), logger: { warn } };
    const res = await pollMelt(d, quest({ targetTaxonIds: [57665], melted: [existing] }));
    expect(res).toEqual({ melted: [existing], newlyMelted: [] });
    expect(warn).toHaveBeenCalled();
  });
});
