import { describe, expect, it, vi } from "vitest";
import { INatClient, RateLimiter } from "../server/inat/client.js";
import { createCache } from "../server/cache.js";
import { INatError } from "../server/inat/types.js";

function resp(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as unknown as Response;
}

function makeClient(fetchImpl: typeof fetch, rps = 0) {
  const cache = createCache(100);
  const client = new INatClient({
    apiBase: "https://api.test/v1",
    userAgent: "test-agent",
    timeoutMs: 1000,
    rateLimiter: new RateLimiter(rps),
    cache,
    userTtlSeconds: 3600,
    placeTtlSeconds: 3600,
    targetsTtlSeconds: 3600,
    meltPollTtlSeconds: 60,
    seasonalityTtlSeconds: 604800,
    fetchImpl,
  });
  return { client, cache };
}

describe("RateLimiter (token bucket)", () => {
  it("serializes concurrent acquisitions to ~rps per second", async () => {
    const waits: number[] = [];
    const sleep = (ms: number) => {
      waits.push(ms);
      return Promise.resolve();
    };
    const rl = new RateLimiter(4, sleep, () => 0); // 4 rps => 250ms spacing
    await Promise.all([rl.acquire(), rl.acquire(), rl.acquire(), rl.acquire()]);
    // The first token is free; each later token is spaced one interval more.
    expect(waits).toEqual([250, 500, 750]);
  });

  it("does not throttle when rps is 0 (disabled)", async () => {
    const waits: number[] = [];
    const rl = new RateLimiter(0, (ms) => {
      waits.push(ms);
      return Promise.resolve();
    });
    await Promise.all([rl.acquire(), rl.acquire(), rl.acquire()]);
    expect(waits).toEqual([]);
  });
});

describe("INatClient caching", () => {
  it("serves a repeat validateUser from cache with no second fetch", async () => {
    const fetchImpl = vi.fn(async () => resp(200, { results: [{ id: 1, login: "kueda", name: "Ken" }] }));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);
    const a = await client.validateUser("kueda");
    const b = await client.validateUser("kueda");
    expect(a?.id).toBe(1);
    expect(b?.id).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns null when there is no exact login match", async () => {
    const fetchImpl = vi.fn(async () => resp(200, { results: [{ id: 2, login: "someoneelse" }] }));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);
    expect(await client.validateUser("kueda")).toBeNull();
  });

  it("caches placesAutocomplete and caps to 10", async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ id: i, name: `P${i}`, display_name: `Place ${i}` }));
    const fetchImpl = vi.fn(async () => resp(200, { results: many }));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);
    const first = await client.placesAutocomplete("cal");
    await client.placesAutocomplete("cal");
    expect(first).toHaveLength(10);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("INatClient error handling", () => {
  it("retries once on a 5xx then surfaces a typed INatError", async () => {
    const fetchImpl = vi.fn(async () => resp(503, {}));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);
    await expect(client.validateUser("kueda")).rejects.toBeInstanceOf(INatError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("wraps a network throw as a typed INatError, never a raw throw", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("network down");
    });
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);
    await expect(client.validateUser("kueda")).rejects.toMatchObject({ name: "INatError", kind: "network" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-429 4xx", async () => {
    const fetchImpl = vi.fn(async () => resp(400, {}));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);
    await expect(client.placesAutocomplete("cal")).rejects.toBeInstanceOf(INatError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("INatClient recentConfirmedObservations", () => {
  const obs = {
    results: [
      {
        id: 555,
        uri: "https://www.inaturalist.org/observations/555",
        observed_on: "2026-09-03",
        taxon: { id: 57665, name: "Cotinis mutabilis", preferred_common_name: "Figeater Beetle" },
        observation_photos: [{ photo: { square_url: "https://x/1/square.jpg", medium_url: "https://x/1/medium.jpg" } }],
      },
      { id: 556, observed_on: "2026-08-01", taxon: null }, // no taxon: skipped
    ],
  };

  it("requests /observations with the confirmed-observation params and maps results", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toContain("/observations?");
      expect(url).toContain("user_id=kueda");
      expect(url).toContain("place_id=14");
      expect(url).toContain("quality_grade=research");
      expect(url).toContain("order_by=observed_on");
      expect(url).toContain("order=desc");
      expect(url).toContain("per_page=200");
      return resp(200, obs);
    });
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);
    const out = await client.recentConfirmedObservations({ login: "kueda", placeId: 14, perPage: 200 });
    expect(out).toHaveLength(1); // the taxon-less result is guarded out
    expect(out[0]).toMatchObject({
      taxonId: 57665,
      commonName: "Figeater Beetle",
      scientificName: "Cotinis mutabilis",
      observationId: 555,
      observationUrl: "https://www.inaturalist.org/observations/555",
      observedOn: "2026-09-03",
      photoUrl: "https://x/1/medium.jpg",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("passes d1 only when sinceIso is set", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toContain("d1=2026-01-01");
      return resp(200, { results: [] });
    });
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);
    await client.recentConfirmedObservations({ login: "kueda", placeId: 14, perPage: 200, sinceIso: "2026-01-01" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("acquires a rate-limiter token before the fetch, then serves a repeat within the TTL from cache", async () => {
    const cache = createCache(100);
    const rl = new RateLimiter(0);
    const acquire = vi.spyOn(rl, "acquire");
    const fetchImpl = vi.fn(async () => resp(200, obs));
    const client = new INatClient({
      apiBase: "https://api.test/v1",
      userAgent: "test-agent",
      timeoutMs: 1000,
      rateLimiter: rl,
      cache,
      userTtlSeconds: 3600,
      placeTtlSeconds: 3600,
      targetsTtlSeconds: 3600,
      meltPollTtlSeconds: 60,
      seasonalityTtlSeconds: 604800,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.recentConfirmedObservations({ login: "kueda", placeId: 14, perPage: 200 });
    expect(acquire).toHaveBeenCalled();
    // A repeat within the TTL is a cache hit: no second upstream fetch.
    await client.recentConfirmedObservations({ login: "kueda", placeId: 14, perPage: 200 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("INatClient weekOfYearHistogram", () => {
  it("requests the histogram params and parses a sparse week_of_year into a dense length-53 array", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toContain("/observations/histogram");
      expect(url).toContain("taxon_id=57665");
      expect(url).toContain("place_id=14");
      expect(url).toContain("date_field=observed");
      expect(url).toContain("interval=week_of_year");
      expect(url).toContain("verifiable=true");
      return resp(200, { results: { week_of_year: { "3": 7, "27": 452, "53": 2 } } });
    });
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);
    const weeks = await client.weekOfYearHistogram({ taxonId: 57665, placeId: 14 });
    expect(weeks).toHaveLength(53);
    expect(weeks[2]).toBe(7);
    expect(weeks[26]).toBe(452);
    expect(weeks[52]).toBe(2);
    expect(weeks[0]).toBe(0); // missing weeks are dense zeros
    expect(weeks.reduce((a, b) => a + b, 0)).toBe(461);
  });

  it("returns all zeros for an empty or absent week_of_year object", async () => {
    const fetchImpl = vi.fn(async () => resp(200, { results: {} }));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);
    const weeks = await client.weekOfYearHistogram({ taxonId: 1, placeId: 14 });
    expect(weeks).toHaveLength(53);
    expect(weeks.every((w) => w === 0)).toBe(true);
  });

  it("serves a repeat (taxonId, placeId) from cache with no second fetch", async () => {
    const fetchImpl = vi.fn(async () => resp(200, { results: { week_of_year: { "10": 5 } } }));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);
    const a = await client.weekOfYearHistogram({ taxonId: 42, placeId: 14 });
    const b = await client.weekOfYearHistogram({ taxonId: 42, placeId: 14 });
    expect(a[9]).toBe(5);
    expect(b).toEqual(a);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("INatClient speciesCounts", () => {
  it("requests one capped page and never materializes the full tail", async () => {
    const results = Array.from({ length: 500 }, (_, i) => ({ count: 1000 - i, taxon: { id: i, name: `T${i}` } }));
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toContain("per_page=500");
      expect(url).toContain("unobserved_by_user_id=kueda");
      return resp(200, { total_results: 12000, results });
    });
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);
    const out = await client.speciesCounts({ login: "kueda", placeId: 14, month: 9, perPage: 500, page: 1 });
    expect(out.total_results).toBe(12000);
    expect(out.results).toHaveLength(500);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
