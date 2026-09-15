import type { BBox, Target } from "./inat/types.js";
import type { MeltedTarget } from "./store/quests.js";

// Pure serializers for the quest export endpoints, kept free of HTTP so the
// formats are unit-testable. Both outputs hold public data only: species
// names, counts, observation provenance, the place name, and the public
// iNaturalist login. Row order is deterministic: found first (newest
// completion first, matching the UI), then open targets in rank order.

export interface ExportQuest {
  login: string; // the public iNaturalist username (display casing)
  placeName: string;
  placeBbox: BBox | null;
}

export const CSV_HEADER =
  "status,common_name,scientific_name,taxon_id,observation_count,distinct_observers,rank_score,found_on,observation_url";

// RFC-4180 quoting plus formula-injection neutralization: a field starting
// with = + - @ (or tab / carriage return) gets a leading apostrophe so a
// spreadsheet never executes a crafted species name as a formula.
function csvField(value: string | number | null): string {
  if (value === null) return "";
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/["\n\r,]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvRow(fields: (string | number | null)[]): string {
  return fields.map(csvField).join(",");
}

function foundFirst(melted: MeltedTarget[]): MeltedTarget[] {
  return [...melted].sort((a, b) => b.meltedAt - a.meltedAt);
}

// The CSV carries no place or login column on purpose: the filename names
// both, and the rows stay pure species data.
export function toCsv(open: Target[], melted: MeltedTarget[]): string {
  const rows = [CSV_HEADER];
  for (const m of foundFirst(melted)) {
    rows.push(csvRow(["found", m.commonName, m.scientificName, m.taxonId, null, null, null, m.observedOn, m.observationUrl]));
  }
  for (const t of open) {
    rows.push(csvRow(["open", t.commonName, t.scientificName, t.taxonId, t.obsCount, t.distinctObservers, t.rankScore, null, null]));
  }
  return rows.join("\r\n") + "\r\n";
}

interface GeoJsonFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] } | null;
  properties: Record<string, string | number | null>;
}

export interface GeoJsonCollection {
  type: "FeatureCollection";
  bbox?: [number, number, number, number];
  features: GeoJsonFeature[];
}

export function toGeoJson(quest: ExportQuest, open: Target[], melted: MeltedTarget[]): GeoJsonCollection {
  // The app holds no per-species point coordinates and never de-obscures
  // any (iNat geoprivacy is preserved product-wide). The location we
  // truthfully have is the quest's place, so every feature sits at the
  // place bounding box centroid; with no bbox the geometry is null.
  const geometry: GeoJsonFeature["geometry"] = quest.placeBbox
    ? {
        type: "Point",
        coordinates: [
          (quest.placeBbox.swLng + quest.placeBbox.neLng) / 2,
          (quest.placeBbox.swLat + quest.placeBbox.neLat) / 2,
        ],
      }
    : null;

  const shared = { place_name: quest.placeName, login: quest.login };

  const features: GeoJsonFeature[] = [
    ...foundFirst(melted).map(
      (m): GeoJsonFeature => ({
        type: "Feature",
        geometry,
        properties: {
          status: "found",
          common_name: m.commonName,
          scientific_name: m.scientificName,
          taxon_id: m.taxonId,
          found_on: m.observedOn,
          observation_url: m.observationUrl,
          ...shared,
        },
      }),
    ),
    ...open.map(
      (t): GeoJsonFeature => ({
        type: "Feature",
        geometry,
        properties: {
          status: "open",
          common_name: t.commonName,
          scientific_name: t.scientificName,
          taxon_id: t.taxonId,
          observation_count: t.obsCount,
          distinct_observers: t.distinctObservers,
          rank_score: t.rankScore,
          ...shared,
        },
      }),
    ),
  ];

  const collection: GeoJsonCollection = { type: "FeatureCollection", features };
  if (quest.placeBbox) {
    collection.bbox = [quest.placeBbox.swLng, quest.placeBbox.swLat, quest.placeBbox.neLng, quest.placeBbox.neLat];
  }
  return collection;
}

// ASCII-safe filename slug from the place name: lowercase, non-alphanumeric
// runs collapsed to a dash, trimmed. Falls back to "place" when nothing
// alphanumeric survives.
export function placeSlug(placeName: string): string {
  const slug = placeName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "place";
}
