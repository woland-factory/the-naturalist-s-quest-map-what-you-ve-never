// Shapes we consume from the iNaturalist API, narrowed to only the fields
// this EPIC reads, plus the types we expose to routes and the frontend.

export interface INatPhoto {
  url?: string;
  square_url?: string;
  medium_url?: string;
}

export interface INatTaxon {
  id: number;
  name: string;
  preferred_common_name?: string;
  default_photo?: INatPhoto | null;
}

export interface SpeciesCount {
  count: number;
  taxon: INatTaxon;
}

export interface SpeciesCountsResponse {
  total_results: number;
  results: SpeciesCount[];
}

export interface UserProfile {
  id: number;
  login: string;
  name: string;
  iconUrl: string | null;
}

export interface Place {
  id: number;
  name: string;
  displayName: string;
}

// A geographic bounding box for framing a map. Longitudes/latitudes in
// decimal degrees; sw is the south-west corner, ne the north-east.
export interface BBox {
  swLat: number;
  swLng: number;
  neLat: number;
  neLng: number;
}

export interface PlaceDetails {
  id: number;
  name: string;
  bbox: BBox | null;
}

// A ranked target as returned to the client.
export interface Target {
  taxonId: number;
  scientificName: string;
  commonName: string;
  photoUrl: string | null;
  obsCount: number;
  distinctObservers: number | null;
  rankScore: number;
}

// Typed adapter error so routes can map upstream trouble to a clean HTTP
// response without ever leaking a raw fetch throw or upstream body.
export class INatError extends Error {
  constructor(
    message: string,
    public readonly kind: "network" | "timeout" | "upstream_status" | "bad_response",
    public readonly status?: number,
  ) {
    super(message);
    this.name = "INatError";
  }
}
