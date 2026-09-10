import { describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../server/app.js";
import { loadConfig, type AppConfig } from "../server/config.js";
import { createCache } from "../server/cache.js";
import { INatClient, RateLimiter } from "../server/inat/client.js";
import { createErrorTracker } from "../server/observability.js";

function resp(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: async () => body } as unknown as Response;
}

interface FetchOpts {
  users?: unknown[];
  places?: unknown[];
  species?: { total_results: number; results: unknown[] };
  observerCount?: number;
  observersThrow?: boolean;
}

function makeFetch(opts: FetchOpts = {}) {
  const calls = { users: 0, places: 0, species: 0, observers: 0 };
  const fetchImpl = vi.fn(async (url: string) => {
    const u = new URL(url);
    if (u.pathname.endsWith("/users/autocomplete")) {
      calls.users++;
      return resp(200, { results: opts.users ?? [{ id: 1, login: "kueda", name: "Ken" }] });
    }
    if (u.pathname.endsWith("/places/autocomplete")) {
      calls.places++;
      return resp(200, { results: opts.places ?? [] });
    }
    if (u.pathname.endsWith("/observations/species_counts")) {
      calls.species++;
      return resp(200, opts.species ?? { total_results: 0, results: [] });
    }
    if (u.pathname.endsWith("/observations/observers")) {
      calls.observers++;
      if (opts.observersThrow) throw new TypeError("network down");
      return resp(200, { total_results: opts.observerCount ?? 5 });
    }
    return resp(404, {});
  });
  return { fetchImpl, calls };
}

function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return { ...loadConfig(), ...overrides };
}

async function buildTestApp(args: {
  fetchImpl?: typeof fetch;
  config?: AppConfig;
  client?: INatClient;
  sentrySdk?: { init: (o: Record<string, unknown>) => void; captureException: (e: unknown) => void };
}): Promise<FastifyInstance> {
  const config = args.config ?? testConfig();
  const cache = createCache(config.cacheMaxEntries);
  const client =
    args.client ??
    new INatClient({
      apiBase: config.inatApiBase,
      userAgent: config.inatUserAgent,
      timeoutMs: config.inatTimeoutMs,
      rateLimiter: new RateLimiter(0),
      cache,
      userTtlSeconds: config.userTtlSeconds,
      placeTtlSeconds: config.placeTtlSeconds,
      targetsTtlSeconds: config.targetsTtlSeconds,
      fetchImpl: args.fetchImpl,
    });
  const tracker = args.sentrySdk ? createErrorTracker(config, args.sentrySdk) : undefined;
  return buildApp({ config, cache, client, tracker, serveStatic: false });
}

function speciesFixture(n: number, total: number) {
  return {
    total_results: total,
    results: Array.from({ length: n }, (_, i) => ({
      count: 1000 - i,
      taxon: { id: 100 + i, name: `Taxon ${i}`, preferred_common_name: `Common ${i}`, default_photo: { medium_url: `https://x/${i}.jpg` } },
    })),
  };
}

describe("GET /api/health", () => {
  it("returns ok", async () => {
    const app = await buildTestApp({ fetchImpl: makeFetch().fetchImpl });
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    await app.close();
  });
});

describe("GET /api/config", () => {
  it("returns umami fields only when set and never a secret", async () => {
    const withUmami = await buildTestApp({
      fetchImpl: makeFetch().fetchImpl,
      config: testConfig({ umamiWebsiteId: "abc", umamiUrl: "https://umami.test/script.js", sentryDsn: "" }),
    });
    const r1 = await withUmami.inject({ method: "GET", url: "/api/config" });
    expect(r1.json()).toEqual({ umamiWebsiteId: "abc", umamiUrl: "https://umami.test/script.js" });
    await withUmami.close();

    const noUmami = await buildTestApp({ fetchImpl: makeFetch().fetchImpl, config: testConfig() });
    const r2 = await noUmami.inject({ method: "GET", url: "/api/config" });
    expect(r2.json()).toEqual({});
    const raw = r2.body;
    expect(raw).not.toContain("INTERNAL_SERVICE_KEY");
    await noUmami.close();
  });

  it("exposes the demo descriptor only when SEED_DEMO is on", async () => {
    const app = await buildTestApp({
      fetchImpl: makeFetch().fetchImpl,
      config: testConfig({ seedDemo: true, seedDemoLogin: "kueda", seedDemoPlaceId: 14, seedDemoPlaceName: "California", seedDemoMonth: 9 }),
    });
    const res = await app.inject({ method: "GET", url: "/api/config" });
    expect(res.json()).toMatchObject({ demo: { login: "kueda", placeId: 14, placeName: "California", month: 9 } });
    await app.close();
  });
});

describe("GET /api/users/validate", () => {
  it("returns the profile for a known login", async () => {
    const app = await buildTestApp({ fetchImpl: makeFetch().fetchImpl });
    const res = await app.inject({ method: "GET", url: "/api/users/validate?login=kueda" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 1, login: "kueda" });
    await app.close();
  });

  it("returns 404 unknown_user for a nonexistent login", async () => {
    const app = await buildTestApp({ fetchImpl: makeFetch({ users: [] }).fetchImpl });
    const res = await app.inject({ method: "GET", url: "/api/users/validate?login=nobodyhere" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "unknown_user", message: "Check the username and try again." });
    await app.close();
  });

  it("rejects a malformed login with 400 and no stack trace", async () => {
    const app = await buildTestApp({ fetchImpl: makeFetch().fetchImpl });
    const res = await app.inject({ method: "GET", url: "/api/users/validate?login=" + encodeURIComponent("bad name!") });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain("at ");
    await app.close();
  });
});

describe("GET /api/places/autocomplete", () => {
  it("returns [] and makes no upstream call under 2 chars", async () => {
    const { fetchImpl, calls } = makeFetch();
    const app = await buildTestApp({ fetchImpl });
    const res = await app.inject({ method: "GET", url: "/api/places/autocomplete?q=a" });
    expect(res.json()).toEqual({ results: [] });
    expect(calls.places).toBe(0);
    await app.close();
  });

  it("caps results to 10", async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: i, name: `P${i}`, display_name: `Place ${i}` }));
    const app = await buildTestApp({ fetchImpl: makeFetch({ places: many }).fetchImpl });
    const res = await app.inject({ method: "GET", url: "/api/places/autocomplete?q=cal" });
    expect(res.json().results).toHaveLength(10);
    await app.close();
  });
});

describe("POST /api/targets", () => {
  it("returns a ranked, shaped list", async () => {
    const app = await buildTestApp({ fetchImpl: makeFetch({ species: speciesFixture(30, 8000), observerCount: 7 }).fetchImpl });
    const res = await app.inject({ method: "POST", url: "/api/targets", payload: { login: "kueda", placeId: 14, month: 9 } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.rankBasis).toBe("frequency+observers");
    expect(body.note).toContain("guide, not a guarantee");
    expect(body.totalAvailable).toBe(8000);
    const first = body.results[0];
    expect(first).toHaveProperty("taxonId");
    expect(first).toHaveProperty("commonName");
    expect(first).toHaveProperty("photoUrl");
    expect(first).toHaveProperty("obsCount");
    expect(first).toHaveProperty("rankScore");
    await app.close();
  });

  it("caps at MAX_TARGETS, paginates, and never fetches the full 12k tail", async () => {
    const { fetchImpl, calls } = makeFetch({ species: speciesFixture(500, 12000), observerCount: 3 });
    const app = await buildTestApp({ fetchImpl, config: testConfig({ maxTargets: 500, pageSize: 20, observerEnrichTopK: 5 }) });
    const res = await app.inject({ method: "POST", url: "/api/targets", payload: { login: "kueda", placeId: 14, month: 9, perPage: 20, page: 1 } });
    const body = res.json();
    expect(body.results.length).toBeLessThanOrEqual(20);
    expect(body.totalTargets).toBeLessThanOrEqual(500);
    expect(body.totalAvailable).toBe(12000);
    expect(calls.species).toBe(1);
    await app.close();
  });

  it("serves repeat queries and later pages from cache, hitting species_counts once", async () => {
    const { fetchImpl, calls } = makeFetch({ species: speciesFixture(50, 5000), observerCount: 4 });
    const app = await buildTestApp({ fetchImpl, config: testConfig({ observerEnrichTopK: 3 }) });
    const p1 = { login: "kueda", placeId: 14, month: 9, page: 1 };
    await app.inject({ method: "POST", url: "/api/targets", payload: p1 });
    await app.inject({ method: "POST", url: "/api/targets", payload: { ...p1, page: 2 } });
    await app.inject({ method: "POST", url: "/api/targets", payload: p1 });
    expect(calls.species).toBe(1);
    await app.close();
  });

  it("still returns 200 with frequency-only head when observer enrichment fails", async () => {
    const app = await buildTestApp({
      fetchImpl: makeFetch({ species: speciesFixture(10, 900), observersThrow: true }).fetchImpl,
      config: testConfig({ observerEnrichTopK: 5 }),
    });
    const res = await app.inject({ method: "POST", url: "/api/targets", payload: { login: "kueda", placeId: 14, month: 9 } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.results.every((t: { distinctObservers: number | null }) => t.distinctObservers === null)).toBe(true);
    expect(body.results.map((t: { taxonId: number }) => t.taxonId)).toEqual(
      Array.from({ length: 10 }, (_, i) => 100 + i),
    );
    await app.close();
  });

  it("returns zero targets as an empty list, not an error", async () => {
    const app = await buildTestApp({ fetchImpl: makeFetch({ species: { total_results: 0, results: [] } }).fetchImpl });
    const res = await app.inject({ method: "POST", url: "/api/targets", payload: { login: "kueda", placeId: 14, month: 9 } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ totalTargets: 0, results: [] });
    await app.close();
  });

  it("returns 404 unknown_user with no stack trace for a bad username", async () => {
    const app = await buildTestApp({ fetchImpl: makeFetch({ users: [] }).fetchImpl });
    const res = await app.inject({ method: "POST", url: "/api/targets", payload: { login: "nobodyhere", placeId: 14, month: 9 } });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "unknown_user", message: "Check the username and try again." });
    expect(res.body).not.toContain("at ");
    await app.close();
  });

  it("maps an upstream failure to 502 in the product's voice", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/users/autocomplete")) return resp(200, { results: [{ id: 1, login: "kueda" }] });
      return resp(503, {});
    });
    const app = await buildTestApp({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const res = await app.inject({ method: "POST", url: "/api/targets", payload: { login: "kueda", placeId: 14, month: 9 } });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: "upstream", message: "iNaturalist is slow right now. Try again in a moment." });
    await app.close();
  });

  it("validates the body and rejects an out-of-range month with 400", async () => {
    const app = await buildTestApp({ fetchImpl: makeFetch().fetchImpl });
    const res = await app.inject({ method: "POST", url: "/api/targets", payload: { login: "kueda", placeId: 14, month: 13 } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe("Sentry wiring", () => {
  it("initializes the SDK when SENTRY_DSN is set", async () => {
    const sdk = { init: vi.fn(), captureException: vi.fn() };
    const app = await buildTestApp({ fetchImpl: makeFetch().fetchImpl, config: testConfig({ sentryDsn: "https://k@example.test/1" }), sentrySdk: sdk });
    expect(sdk.init).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("does not initialize when SENTRY_DSN is unset", async () => {
    const sdk = { init: vi.fn(), captureException: vi.fn() };
    const app = await buildTestApp({ fetchImpl: makeFetch().fetchImpl, config: testConfig({ sentryDsn: "" }), sentrySdk: sdk });
    expect(sdk.init).not.toHaveBeenCalled();
    await app.close();
  });

  it("captures an unexpected route error without attaching the username, and returns a clean 500", async () => {
    const sdk = { init: vi.fn(), captureException: vi.fn() };
    const throwingClient = {
      validateUser: async () => {
        throw new Error("boom");
      },
    } as unknown as INatClient;
    const app = await buildTestApp({ config: testConfig({ sentryDsn: "https://k@example.test/1" }), sentrySdk: sdk, client: throwingClient });
    const res = await app.inject({ method: "POST", url: "/api/targets", payload: { login: "kueda", placeId: 14, month: 9 } });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "server_error", message: "Try again in a moment." });
    expect(sdk.captureException).toHaveBeenCalledTimes(1);
    const captured = JSON.stringify(sdk.captureException.mock.calls[0]?.[0] ?? {});
    expect(captured).not.toContain("kueda");
    expect(res.body).not.toContain("at ");
    await app.close();
  });
});
