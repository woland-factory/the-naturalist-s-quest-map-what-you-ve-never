import type { Cache } from "../cache.js";
import { observersKey, placeDetailKey, placeKey, userKey } from "../cache.js";
import { INatError } from "./types.js";
import type { BBox, Place, PlaceDetails, SpeciesCount, SpeciesCountsResponse, UserProfile } from "./types.js";

// The ONE place iNaturalist is ever called. Every method acquires a token
// from a single process-wide bucket before its fetch, so all iNat traffic
// stays within the polite ~1 req/s guidance no matter how many requests
// arrive at once. Reads go through the cache first. Upstream failures are
// retried once, then surface as a typed INatError, never a raw fetch throw.

/**
 * A single global token bucket. Callers await acquire() which resolves no
 * sooner than the minimum interval after the previous acquisition, so N
 * concurrent callers are serialized to ~rps per second.
 */
export class RateLimiter {
  private nextFreeAt = 0;
  private readonly intervalMs: number;

  constructor(rps: number, private readonly sleep: (ms: number) => Promise<void> = defaultSleep, private readonly now: () => number = Date.now) {
    this.intervalMs = rps > 0 ? 1000 / rps : 0;
  }

  async acquire(): Promise<void> {
    if (this.intervalMs <= 0) return;
    const now = this.now();
    const scheduled = Math.max(now, this.nextFreeAt);
    this.nextFreeAt = scheduled + this.intervalMs;
    const wait = scheduled - now;
    if (wait > 0) await this.sleep(wait);
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface INatClientOptions {
  apiBase: string;
  userAgent: string;
  timeoutMs: number;
  rateLimiter: RateLimiter;
  cache: Cache;
  userTtlSeconds: number;
  placeTtlSeconds: number;
  targetsTtlSeconds: number;
  fetchImpl?: typeof fetch;
}

interface RawUser {
  id: number;
  login: string;
  name?: string | null;
  icon?: string | null;
  icon_url?: string | null;
}

interface RawPlace {
  id: number;
  name: string;
  display_name?: string;
  bounding_box_geojson?: unknown;
}

// iNaturalist returns the place bounding box as a GeoJSON geometry. We only
// need its extent, so flatten every coordinate pair and take the min/max.
// This handles Polygon and MultiPolygon without caring which it is.
function parseBBox(geo: unknown): BBox | null {
  if (!geo || typeof geo !== "object") return null;
  const coords = (geo as { coordinates?: unknown }).coordinates;
  const points: [number, number][] = [];
  const collect = (node: unknown): void => {
    if (!Array.isArray(node)) return;
    if (typeof node[0] === "number" && typeof node[1] === "number") {
      points.push([node[0], node[1]]);
      return;
    }
    for (const child of node) collect(child);
  };
  collect(coords);
  if (points.length === 0) return null;
  let swLat = Infinity;
  let swLng = Infinity;
  let neLat = -Infinity;
  let neLng = -Infinity;
  for (const [lng, lat] of points) {
    if (lat < swLat) swLat = lat;
    if (lat > neLat) neLat = lat;
    if (lng < swLng) swLng = lng;
    if (lng > neLng) neLng = lng;
  }
  return { swLat, swLng, neLat, neLng };
}

export class INatClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: INatClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private url(path: string, params: Record<string, string | number | undefined>): string {
    const u = new URL(this.opts.apiBase + path);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") u.searchParams.set(k, String(v));
    }
    return u.toString();
  }

  // One fetch with a timeout and a single retry on network error / 5xx / 429.
  private async request<T>(url: string): Promise<T> {
    await this.opts.rateLimiter.acquire();
    let attempt = 0;
    let lastError: INatError | null = null;
    while (attempt < 2) {
      attempt++;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
      try {
        const res = await this.fetchImpl(url, {
          signal: controller.signal,
          headers: {
            "User-Agent": this.opts.userAgent,
            Accept: "application/json",
          },
        });
        clearTimeout(timer);
        if (res.status >= 500 || res.status === 429) {
          lastError = new INatError(`iNaturalist responded ${res.status}`, "upstream_status", res.status);
        } else if (!res.ok) {
          // 4xx other than 429 is not retryable; treat as a bad response.
          throw new INatError(`iNaturalist responded ${res.status}`, "upstream_status", res.status);
        } else {
          try {
            return (await res.json()) as T;
          } catch {
            throw new INatError("iNaturalist returned an unreadable response", "bad_response");
          }
        }
      } catch (err) {
        clearTimeout(timer);
        if (err instanceof INatError) {
          if (err.kind === "upstream_status" && err.status !== undefined && err.status < 500 && err.status !== 429) {
            throw err; // non-retryable
          }
          lastError = err;
        } else if (err instanceof Error && err.name === "AbortError") {
          lastError = new INatError("iNaturalist timed out", "timeout");
        } else {
          lastError = new INatError("Could not reach iNaturalist", "network");
        }
      }
      if (attempt < 2) {
        // one short backoff before the single retry; the rate limiter also
        // spaces the retry so we never hammer a struggling upstream.
        await this.opts.rateLimiter.acquire();
      }
    }
    throw lastError ?? new INatError("Could not reach iNaturalist", "network");
  }

  /** Exact-login validation. Returns the profile or null when no exact match. */
  async validateUser(login: string): Promise<UserProfile | null> {
    const key = userKey(login);
    const cached = this.opts.cache.get<UserProfile | null>(key);
    if (cached !== undefined) return cached;

    const url = this.url("/users/autocomplete", { q: login, per_page: 10 });
    const data = await this.request<{ results: RawUser[] }>(url);
    const match = (data.results ?? []).find((u) => u.login?.toLowerCase() === login.toLowerCase());
    const profile: UserProfile | null = match
      ? {
          id: match.id,
          login: match.login,
          name: match.name || match.login,
          iconUrl: match.icon_url || match.icon || null,
        }
      : null;
    this.opts.cache.set(key, profile, this.opts.userTtlSeconds);
    return profile;
  }

  /** Place autocomplete, capped to ~10 results. */
  async placesAutocomplete(q: string): Promise<Place[]> {
    const key = placeKey(q);
    const cached = this.opts.cache.get<Place[]>(key);
    if (cached !== undefined) return cached;

    const url = this.url("/places/autocomplete", { q, per_page: 10 });
    const data = await this.request<{ results: RawPlace[] }>(url);
    const places: Place[] = (data.results ?? []).slice(0, 10).map((p) => ({
      id: p.id,
      name: p.name,
      displayName: p.display_name || p.name,
    }));
    this.opts.cache.set(key, places, this.opts.placeTtlSeconds);
    return places;
  }

  /**
   * Place details with a bounding box, used once at quest creation to frame
   * the map. Cached under the place TTL so reopening a quest never re-fetches
   * it and the map never fans out iNat calls.
   */
  async placeDetails(placeId: number): Promise<PlaceDetails> {
    const key = placeDetailKey(placeId);
    const cached = this.opts.cache.get<PlaceDetails>(key);
    if (cached !== undefined) return cached;

    const url = this.url(`/places/${placeId}`, {});
    const data = await this.request<{ results?: RawPlace[] }>(url);
    const first = (data.results ?? [])[0];
    const details: PlaceDetails = {
      id: placeId,
      name: first?.display_name || first?.name || "",
      bbox: parseBBox(first?.bounding_box_geojson),
    };
    this.opts.cache.set(key, details, this.opts.placeTtlSeconds);
    return details;
  }

  /**
   * The one call that produces the frequency ranking: species the user has
   * never recorded, seen by anyone at this place in this month.
   */
  async speciesCounts(args: {
    login: string;
    placeId: number;
    month: number;
    taxonRootId?: number;
    perPage: number;
    page: number;
  }): Promise<SpeciesCountsResponse> {
    const url = this.url("/observations/species_counts", {
      unobserved_by_user_id: args.login,
      place_id: args.placeId,
      month: args.month,
      taxon_id: args.taxonRootId,
      per_page: args.perPage,
      page: args.page,
    });
    const data = await this.request<{ total_results: number; results: SpeciesCount[] }>(url);
    return {
      total_results: data.total_results ?? 0,
      results: data.results ?? [],
    };
  }

  /** Distinct-observer count for one species at a place/month. Cached. */
  async distinctObservers(args: { taxonId: number; placeId: number; month: number }): Promise<number> {
    const key = observersKey(args.taxonId, args.placeId, args.month);
    const cached = this.opts.cache.get<number>(key);
    if (cached !== undefined) return cached;

    const url = this.url("/observations/observers", {
      taxon_id: args.taxonId,
      place_id: args.placeId,
      month: args.month,
      per_page: 0,
    });
    const data = await this.request<{ total_results: number }>(url);
    const total = data.total_results ?? 0;
    this.opts.cache.set(key, total, this.opts.targetsTtlSeconds);
    return total;
  }
}
