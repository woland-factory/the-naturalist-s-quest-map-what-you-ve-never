import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { taxonTileUrl } from "../tiles.js";
import type { BBox } from "../types.js";

interface Props {
  tileBase: string;
  taxonId: number;
  placeId: number;
  month: number;
  commonName: string;
  bbox: BBox | null;
}

// A Leaflet map: an OpenStreetMap base layer for geographic context plus one
// iNaturalist per-taxon overlay showing where the selected species is found.
// If the taxon tiles fail to load (offline, upstream down, empty coverage)
// the map shows a calm fallback and the list below stays fully usable.
export function QuestMap({ tileBase, taxonId, placeId, month, commonName, bbox }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const overlayRef = useRef<L.TileLayer | null>(null);
  const [tilesFailed, setTilesFailed] = useState(false);

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { attributionControl: true, scrollWheelZoom: false });
    mapRef.current = map;

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "Map data &copy; OpenStreetMap contributors",
    }).addTo(map);

    if (bbox) {
      map.fitBounds([
        [bbox.swLat, bbox.swLng],
        [bbox.neLat, bbox.neLng],
      ]);
    } else {
      map.setView([20, 0], 2);
    }

    return () => {
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
    };
    // The base map is framed once from the initial bbox; taxon changes only
    // swap the overlay in the effect below, so this runs a single time.
  }, []);

  // Swap the taxon overlay whenever the selected species changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    setTilesFailed(false);
    if (overlayRef.current) {
      overlayRef.current.remove();
      overlayRef.current = null;
    }
    const overlay = L.tileLayer(taxonTileUrl(tileBase, taxonId, placeId, month), {
      opacity: 0.8,
      attribution: "Observations &copy; iNaturalist",
    });
    overlay.on("tileerror", () => setTilesFailed(true));
    overlay.addTo(map);
    overlayRef.current = overlay;
  }, [tileBase, taxonId, placeId, month]);

  return (
    <div className="quest-map-wrap">
      <div className="quest-map" ref={containerRef} role="img" aria-label={`Map of where to find ${commonName}`} />
      {tilesFailed && (
        <div className="map-fallback" role="status">
          The map didn't load. Your targets are listed below.
        </div>
      )}
    </div>
  );
}
