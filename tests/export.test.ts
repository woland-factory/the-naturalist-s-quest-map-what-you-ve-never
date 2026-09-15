import { describe, expect, it } from "vitest";
import { CSV_HEADER, placeSlug, toCsv, toGeoJson, type ExportQuest } from "../server/export.js";
import type { BBox, Target } from "../server/inat/types.js";
import type { MeltedTarget } from "../server/store/quests.js";

const BBOX: BBox = { swLat: 32.5, swLng: -124.5, neLat: 42, neLng: -114 };

function quest(over: Partial<ExportQuest> = {}): ExportQuest {
  return { login: "kueda", placeName: "California", placeBbox: BBOX, ...over };
}

function target(over: Partial<Target> = {}): Target {
  return {
    taxonId: 57665,
    scientificName: "Cotinis mutabilis",
    commonName: "Figeater Beetle",
    photoUrl: null,
    obsCount: 2583,
    distinctObservers: 1200,
    rankScore: 0.97,
    ...over,
  };
}

function melted(over: Partial<MeltedTarget> = {}): MeltedTarget {
  return {
    taxonId: 4981,
    scientificName: "Nycticorax nycticorax",
    commonName: "Black-crowned Night Heron",
    photoUrl: "https://x/720002534/medium.jpg",
    observationId: 392852733,
    observationUrl: "https://www.inaturalist.org/observations/392852733",
    observedOn: "2026-08-17",
    meltedAt: 100,
    ...over,
  };
}

describe("toCsv", () => {
  it("emits the exact header and column order, found rows (newest first) before open rows", () => {
    const csv = toCsv(
      [target(), target({ taxonId: 2, commonName: "Second", scientificName: "S s", obsCount: 10, distinctObservers: null, rankScore: 0.5 })],
      [melted(), melted({ taxonId: 5, commonName: "Newer Find", meltedAt: 200, observedOn: "2026-09-10" })],
    );
    const lines = csv.trim().split(/\r\n/);
    expect(lines[0]).toBe(CSV_HEADER);
    expect(lines[0]).toBe(
      "status,common_name,scientific_name,taxon_id,observation_count,distinct_observers,rank_score,found_on,observation_url",
    );
    // Newest completion first, then the older found, then open in rank order.
    expect(lines[1]).toBe("found,Newer Find,Nycticorax nycticorax,5,,,,2026-09-10,https://www.inaturalist.org/observations/392852733");
    expect(lines[2]).toBe(
      "found,Black-crowned Night Heron,Nycticorax nycticorax,4981,,,,2026-08-17,https://www.inaturalist.org/observations/392852733",
    );
    expect(lines[3]).toBe("open,Figeater Beetle,Cotinis mutabilis,57665,2583,1200,0.97,,");
    // Unknown observer count is blank, not "null".
    expect(lines[4]).toBe("open,Second,S s,2,10,,0.5,,");
  });

  it("RFC-4180 quotes fields containing commas, quotes, or newlines", () => {
    const csv = toCsv([target({ commonName: 'Say "hi", friend', scientificName: "A\nB" })], []);
    const row = csv.trim().split(/\r\n/)[1];
    expect(row).toContain('"Say ""hi"", friend"');
    expect(row).toContain('"A\nB"');
  });

  it("neutralizes formula injection: a leading = + - @ gets an apostrophe prefix", () => {
    for (const evil of ["=1+1", "+1", "-1", "@cmd"]) {
      const csv = toCsv([target({ commonName: evil })], []);
      expect(csv).toContain(`'${evil}`);
    }
  });

  it("an empty quest yields a header-only file", () => {
    expect(toCsv([], []).trim()).toBe(CSV_HEADER);
  });
});

describe("toGeoJson", () => {
  it("is a FeatureCollection with one feature per target at the bbox centroid in [lng, lat] order", () => {
    const geo = toGeoJson(quest(), [target()], [melted()]);
    expect(geo.type).toBe("FeatureCollection");
    expect(geo.bbox).toEqual([-124.5, 32.5, -114, 42]);
    expect(geo.features).toHaveLength(2);
    for (const f of geo.features) {
      expect(f.type).toBe("Feature");
      expect(f.geometry).toEqual({ type: "Point", coordinates: [-119.25, 37.25] });
    }
    expect(geo.features[0].properties).toEqual({
      status: "found",
      common_name: "Black-crowned Night Heron",
      scientific_name: "Nycticorax nycticorax",
      taxon_id: 4981,
      found_on: "2026-08-17",
      observation_url: "https://www.inaturalist.org/observations/392852733",
      place_name: "California",
      login: "kueda",
    });
    expect(geo.features[1].properties).toEqual({
      status: "open",
      common_name: "Figeater Beetle",
      scientific_name: "Cotinis mutabilis",
      taxon_id: 57665,
      observation_count: 2583,
      distinct_observers: 1200,
      rank_score: 0.97,
      place_name: "California",
      login: "kueda",
    });
  });

  it("uses null geometry and no bbox when the place has no bounding box", () => {
    const geo = toGeoJson(quest({ placeBbox: null }), [target()], []);
    expect(geo.bbox).toBeUndefined();
    expect(geo.features[0].geometry).toBeNull();
  });

  it("holds only public data: no email-shaped string and no person field beyond the public login", () => {
    const geo = JSON.stringify(toGeoJson(quest(), [target()], [melted()]));
    const csv = toCsv([target()], [melted()]);
    for (const serialized of [geo, csv]) {
      expect(serialized).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/); // nothing email-shaped
      expect(serialized).not.toMatch(/password|secret|token|api[_-]?key/i);
    }
    const personKeys = Object.keys(JSON.parse(geo).features[0].properties).filter((k) =>
      /login|user|name|email|person/i.test(k),
    );
    // common_name/scientific_name/place_name name species and places, not people.
    expect(personKeys.sort()).toEqual(["common_name", "login", "place_name", "scientific_name"]);
  });
});

describe("placeSlug", () => {
  it("lowercases and collapses non-alphanumeric runs to single dashes", () => {
    expect(placeSlug("California, US")).toBe("california-us");
    expect(placeSlug("  Baja   California!  ")).toBe("baja-california");
  });

  it("falls back to a safe name when nothing alphanumeric survives", () => {
    expect(placeSlug("日本")).toBe("place");
  });
});
