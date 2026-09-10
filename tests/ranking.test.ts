import { describe, expect, it } from "vitest";
import { blendTargets, WEIGHT_FREQUENCY, WEIGHT_OBSERVERS } from "../server/inat/ranking.js";
import type { SpeciesCount } from "../server/inat/types.js";

function sc(id: number, count: number, common?: string): SpeciesCount {
  return {
    count,
    taxon: {
      id,
      name: `Taxon ${id}`,
      preferred_common_name: common,
      default_photo: { medium_url: `https://example.test/${id}.jpg` },
    },
  };
}

describe("ranking blend", () => {
  it("weights sum to 1", () => {
    expect(WEIGHT_FREQUENCY + WEIGHT_OBSERVERS).toBeCloseTo(1);
  });

  it("lets a widely-observed species outrank a slightly-more-frequent one in the head", () => {
    // A has the higher raw count but few observers; B is found by many more
    // people. With observer softening, B should rank above A.
    const counts = [sc(1, 100), sc(2, 90), sc(3, 10), sc(4, 5)];
    const observers = new Map<number, number | null>([
      [1, 3],
      [2, 80],
      [3, 2],
      [4, 1],
    ]);
    const ranked = blendTargets(counts, observers, 2);
    expect(ranked[0].taxonId).toBe(2);
    expect(ranked[1].taxonId).toBe(1);
    // the head carries observer counts; the tail does not
    expect(ranked[0].distinctObservers).toBe(80);
    expect(ranked[2].distinctObservers).toBeNull();
    expect(ranked[3].distinctObservers).toBeNull();
  });

  it("is deterministic for identical input", () => {
    const counts = [sc(1, 50), sc(2, 40), sc(3, 30)];
    const obs = new Map<number, number | null>([[1, 5], [2, 9], [3, 1]]);
    const a = blendTargets(counts, obs, 3);
    const b = blendTargets(counts, obs, 3);
    expect(a).toEqual(b);
  });

  it("degrades to frequency order when no observers were fetched", () => {
    const counts = [sc(1, 100), sc(2, 80), sc(3, 60)];
    const ranked = blendTargets(counts, new Map(), 3);
    expect(ranked.map((t) => t.taxonId)).toEqual([1, 2, 3]);
    expect(ranked.every((t) => t.distinctObservers === null)).toBe(true);
    // scores strictly decrease with frequency
    expect(ranked[0].rankScore).toBeGreaterThanOrEqual(ranked[1].rankScore);
    expect(ranked[1].rankScore).toBeGreaterThanOrEqual(ranked[2].rankScore);
  });

  it("prefers the common name and picks a photo url", () => {
    const ranked = blendTargets([sc(1, 10, "Monarch")], new Map(), 1);
    expect(ranked[0].commonName).toBe("Monarch");
    expect(ranked[0].scientificName).toBe("Taxon 1");
    expect(ranked[0].photoUrl).toBe("https://example.test/1.jpg");
  });

  it("returns an empty list for no counts", () => {
    expect(blendTargets([], new Map(), 25)).toEqual([]);
  });
});
