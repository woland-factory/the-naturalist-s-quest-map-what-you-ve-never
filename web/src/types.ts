export interface Target {
  taxonId: number;
  scientificName: string;
  commonName: string;
  photoUrl: string | null;
  obsCount: number;
  distinctObservers: number | null;
  rankScore: number;
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

export interface DemoDescriptor {
  login: string;
  placeId: number;
  placeName: string;
  month: number;
}

export interface AppConfig {
  umamiWebsiteId?: string;
  umamiUrl?: string;
  sentryDsn?: string;
  demo?: DemoDescriptor;
}
