export interface Target {
  taxonId: number;
  scientificName: string;
  commonName: string;
  photoUrl: string | null;
  obsCount: number;
  distinctObservers: number | null;
  rankScore: number;
}

// A target the user has already photographed and the community confirmed, so
// it has crossed itself off the quest, shown with the photo that completed it.
export interface MeltedTarget {
  taxonId: number;
  scientificName: string;
  commonName: string;
  photoUrl: string | null;
  observationId: number;
  observationUrl: string;
  observedOn: string | null;
  meltedAt: number;
}

export interface TargetsResponse {
  page: number;
  perPage: number;
  totalTargets: number;
  totalAvailable: number;
  rankBasis: string;
  note: string;
  results: Target[];
}

export interface Place {
  id: number;
  name: string;
  displayName: string;
}

export interface BBox {
  swLat: number;
  swLng: number;
  neLat: number;
  neLng: number;
}

// A saved quest as the list and quest screens see it.
export interface QuestSummary {
  id: string;
  login: string;
  placeId: number;
  placeName: string;
  placeBbox: BBox | null;
  taxonRootId: number | null;
  seasonMonth: number;
  targetCount: number;
  totalAvailable: number;
  createdAt: number;
  lastRefreshedAt: number;
  openCount: number;
  meltedCount: number;
}

// Create and reopen return the quest plus its first page of targets, and the
// full melted set with any taxa first melted on this open.
export interface QuestResponse extends TargetsResponse {
  quest: QuestSummary;
  melted: MeltedTarget[];
  newlyMelted: number[];
}

export interface DemoDescriptor {
  login: string;
  placeId: number;
  placeName: string;
  month: number;
}

export interface AppConfig {
  inatTileBase?: string;
  seasonalityTopN?: number;
  umamiWebsiteId?: string;
  umamiUrl?: string;
  sentryDsn?: string;
  demo?: DemoDescriptor;
}
