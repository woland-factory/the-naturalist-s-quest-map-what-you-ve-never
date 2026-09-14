// The per-taxon map tile URL. iNaturalist serves raster observation tiles
// per taxon and already obscures threatened/obscured observations server
// side, so we render tiles only and NEVER pass a coordinate or any
// de-obfuscation parameter. The query carries exactly taxon_id, place_id,
// and month. Kept a pure function so a unit test can prove no forbidden
// parameter is ever emitted.
export function taxonTileUrl(base: string, taxonId: number, placeId: number, month: number): string {
  const clean = base.replace(/\/+$/, "");
  const params = new URLSearchParams({
    taxon_id: String(taxonId),
    place_id: String(placeId),
    month: String(month),
  });
  return `${clean}/grid/{z}/{x}/{y}.png?${params.toString()}`;
}
