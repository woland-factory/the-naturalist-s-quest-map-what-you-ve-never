import { describe, expect, it } from "vitest";
import { taxonTileUrl } from "../web/src/tiles.js";

// Geoprivacy is load-bearing: our per-taxon tile URL must carry ONLY
// taxon_id, place_id, and month. Any coordinate or de-obfuscation parameter
// would risk revealing an obscured location, so we assert the query is
// exactly those three keys and nothing else.
describe("taxonTileUrl", () => {
  it("emits only taxon_id, place_id, and month", () => {
    const url = taxonTileUrl("https://api.inaturalist.org/v1", 5000, 14, 9);
    const query = new URL(url.replace("{z}/{x}/{y}", "1/2/3")).searchParams;
    expect([...query.keys()].sort()).toEqual(["month", "place_id", "taxon_id"]);
    expect(query.get("taxon_id")).toBe("5000");
    expect(query.get("place_id")).toBe("14");
    expect(query.get("month")).toBe("9");
  });

  it("carries no coordinate or de-obfuscation parameter", () => {
    const url = taxonTileUrl("https://api.inaturalist.org/v1", 42, 1, 3).toLowerCase();
    for (const forbidden of ["lat", "lng", "lon", "nelat", "swlat", "coordinate", "geo", "obscur", "bbox"]) {
      expect(url.includes(`${forbidden}=`)).toBe(false);
    }
  });

  it("keeps the Leaflet {z}/{x}/{y} template and a single .png path", () => {
    const url = taxonTileUrl("https://api.inaturalist.org/v1/", 1, 1, 1);
    expect(url).toContain("/grid/{z}/{x}/{y}.png?");
    // A trailing slash on the base does not double up.
    expect(url).not.toContain("v1//grid");
  });
});
