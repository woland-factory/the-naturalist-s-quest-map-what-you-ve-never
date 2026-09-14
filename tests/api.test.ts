import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../server/app.js";
import { loadConfig, type AppConfig } from "../server/config.js";
import { createCache } from "../server/cache.js";
import { INatClient, RateLimiter } from "../server/inat/client.js";
import { createErrorTracker } from "../server/observability.js";
import { createMemoryQuestStore, createFileQuestStore, type QuestStore } from "../server/store/quests.js";

function resp(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: async () => body } as unknown as Response;
}

const CA_BBOX_GEOJSON = {
  type: "Polygon",
  coordinates: [[[-124.5, 32.5], [-114, 32.5], [-114, 42], [-124.5, 42], [-124.5, 32.5]]],
};

interface FetchOpts {
  users?: unknown[];
  places?: unknown[];
  species?: { total_results: number; results: unknown[] };
  observerCount?: number;
  observersThrow?: boolean;
  placeDetailThrow?: boolean;
}

function makeFetch(opts: FetchOpts = {}) {
  const calls = { users: 0, places: 0, placeDetail: 0, species: 0, observers: 0, speciesMonths: [] as string[] };
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
    if (/\/places\/\d+$/.test(u.pathname)) {
      calls.placeDetail++;
      if (opts.placeDetailThrow) throw new TypeError("network down");
      return resp(200, {
        results: [{ id: 14, name: "California", display_name: "California, US", bounding_box_geojson: CA_BBOX_GEOJSON }],
      });
    }
    if (u.pathname.endsWith("/observations/species_counts")) {
      calls.species++;
      calls.speciesMonths.push(u.searchParams.get("month") ?? "");
      return resp(200, opts.species ?? { total_results: 0, results: [] });
    }
    if (u.pathname.endsWith("/observations/observers")) {
      calls.observers++;
      if (opts.observersThrow) throw new TypeError("network down");
      return resp(200, { total_results: opts.observerCount ?? 5 });
    }
    return resp(404, {});
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return { ...loadConfig(), ...overrides };
}

async function buildTestApp(args: {
  fetchImpl?: typeof fetch;
  config?: AppConfig;
  client?: INatClient;
  questStore?: QuestStore;
  now?: () => number;
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
      meltPollTtlSeconds: config.meltPollTtlSeconds,
      fetchImpl: args.fetchImpl,
    });
  const tracker = args.sentrySdk ? createErrorTracker(config, args.sentrySdk) : undefined;
  const questStore = args.questStore ?? createMemoryQuestStore();
  return buildApp({ config, cache, client, tracker, questStore, now: args.now, serveStatic: false });
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

const CREATE = { login: "kueda", placeId: 14, placeName: "California" };

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
  it("returns the public tile base and umami fields only when set, never a secret", async () => {
    const withUmami = await buildTestApp({
      fetchImpl: makeFetch().fetchImpl,
      config: testConfig({ umamiWebsiteId: "abc", umamiUrl: "https://umami.test/script.js", sentryDsn: "", inatApiBase: "https://api.inaturalist.org/v1" }),
    });
    const r1 = await withUmami.inject({ method: "GET", url: "/api/config" });
    expect(r1.json()).toEqual({
      inatTileBase: "https://api.inaturalist.org/v1",
      umamiWebsiteId: "abc",
      umamiUrl: "https://umami.test/script.js",
    });
    await withUmami.close();

    const noUmami = await buildTestApp({ fetchImpl: makeFetch().fetchImpl, config: testConfig({ inatApiBase: "https://api.inaturalist.org/v1" }) });
    const r2 = await noUmami.inject({ method: "GET", url: "/api/config" });
    expect(r2.json()).toEqual({ inatTileBase: "https://api.inaturalist.org/v1" });
    expect(r2.body).not.toContain("INTERNAL_SERVICE_KEY");
    await noUmami.close();
  });

  it("exposes the demo descriptor only when SEED_DEMO is on", async () => {
    const app = await buildTestApp({
      fetchImpl: makeFetch().fetchImpl,
      config: testConfig({ seedDemo: true, seedDemoLogin: "kueda", seedDemoPlaceId: 14, seedDemoPlaceName: "California", seedDemoMonth: 9 }),
    });
    const res = await app.inject({ method: "GET", url: "/api/config" });
    expect(res.json()).toMatchObject({ demo: { login: "kueda", placeId: 14, placeName: "California" } });
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

describe("POST /api/quests", () => {
  it("creates a quest, persists it, and returns a ranked, shaped list with the quest summary", async () => {
    const store = createMemoryQuestStore();
    const app = await buildTestApp({
      fetchImpl: makeFetch({ species: speciesFixture(30, 8000), observerCount: 7 }).fetchImpl,
      questStore: store,
    });
    const res = await app.inject({ method: "POST", url: "/api/quests", payload: CREATE });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.rankBasis).toBe("frequency+observers");
    expect(body.note).toContain("guide, not a guarantee");
    expect(body.totalAvailable).toBe(8000);
    expect(body.quest).toMatchObject({ placeId: 14, placeName: "California", login: "kueda" });
    expect(body.quest.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.quest.placeBbox).toMatchObject({ swLat: 32.5, neLat: 42 });
    const first = body.results[0];
    expect(first).toHaveProperty("taxonId");
    expect(first).toHaveProperty("commonName");
    expect(first).toHaveProperty("photoUrl");
    // The quest is in the store, keyed to the login.
    expect(store.countByLogin("kueda")).toBe(1);
    await app.close();
  });

  it("persists across a restart: a second app over the same file store lists the quest", async () => {
    const dir = mkdtempSync(join(tmpdir(), "quest-api-"));
    const file = join(dir, "quests.json");
    try {
      const first = await buildTestApp({
        fetchImpl: makeFetch({ species: speciesFixture(10, 900), observerCount: 3 }).fetchImpl,
        questStore: createFileQuestStore(file),
      });
      const created = await first.inject({ method: "POST", url: "/api/quests", payload: CREATE });
      expect(created.statusCode).toBe(201);
      await first.close();

      // A brand-new app instance over the same file, as if the server restarted.
      const second = await buildTestApp({ fetchImpl: makeFetch().fetchImpl, questStore: createFileQuestStore(file) });
      const list = await second.inject({ method: "GET", url: "/api/quests?login=kueda" });
      expect(list.json().quests).toHaveLength(1);
      expect(list.json().quests[0]).toMatchObject({ placeName: "California" });
      await second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ranks for the CURRENT season month, not a stored one", async () => {
    const { fetchImpl, calls } = makeFetch({ species: speciesFixture(5, 50), observerCount: 2 });
    const march = () => Date.UTC(2026, 2, 10); // March
    const app = await buildTestApp({ fetchImpl, now: march });
    const res = await app.inject({ method: "POST", url: "/api/quests", payload: CREATE });
    expect(res.statusCode).toBe(201);
    expect(res.json().quest.seasonMonth).toBe(3);
    expect(calls.speciesMonths).toEqual(["3"]);
    await app.close();
  });

  it("still creates when the place bbox lookup fails (best-effort framing)", async () => {
    const app = await buildTestApp({
      fetchImpl: makeFetch({ species: speciesFixture(5, 50), placeDetailThrow: true }).fetchImpl,
    });
    const res = await app.inject({ method: "POST", url: "/api/quests", payload: CREATE });
    expect(res.statusCode).toBe(201);
    expect(res.json().quest.placeBbox).toBeNull();
    await app.close();
  });

  it("returns 409 quest_limit in the product's voice past the per-user cap", async () => {
    const app = await buildTestApp({
      fetchImpl: makeFetch({ species: speciesFixture(3, 30) }).fetchImpl,
      config: testConfig({ maxQuestsPerUser: 2 }),
    });
    await app.inject({ method: "POST", url: "/api/quests", payload: CREATE });
    await app.inject({ method: "POST", url: "/api/quests", payload: CREATE });
    const over = await app.inject({ method: "POST", url: "/api/quests", payload: CREATE });
    expect(over.statusCode).toBe(409);
    expect(over.json()).toEqual({
      error: "quest_limit",
      message: "You've saved the most quests we keep. Open one you have, or remove one to add another.",
    });
    await app.close();
  });

  it("rate limits creation, returning 429 with the existing copy", async () => {
    const app = await buildTestApp({
      fetchImpl: makeFetch({ species: speciesFixture(3, 30) }).fetchImpl,
      config: testConfig({ questsRateLimitMax: 1 }),
    });
    const first = await app.inject({ method: "POST", url: "/api/quests", payload: CREATE });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({ method: "POST", url: "/api/quests", payload: CREATE });
    expect(second.statusCode).toBe(429);
    expect(second.json()).toEqual({ error: "rate_limited", message: "Too many requests. Wait a moment and try again." });
    await app.close();
  });

  it("returns 404 unknown_user with no stack trace for a bad username", async () => {
    const app = await buildTestApp({ fetchImpl: makeFetch({ users: [] }).fetchImpl });
    const res = await app.inject({ method: "POST", url: "/api/quests", payload: { ...CREATE, login: "nobodyhere" } });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "unknown_user", message: "Check the username and try again." });
    expect(res.body).not.toContain("at ");
    await app.close();
  });

  it("maps an upstream failure to 502 in the product's voice", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/users/autocomplete")) return resp(200, { results: [{ id: 1, login: "kueda" }] });
      if (/\/places\/\d+$/.test(new URL(url).pathname)) return resp(200, { results: [] });
      return resp(503, {});
    });
    const app = await buildTestApp({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const res = await app.inject({ method: "POST", url: "/api/quests", payload: CREATE });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: "upstream", message: "iNaturalist is slow right now. Try again in a moment." });
    await app.close();
  });

  it("validates the body and rejects an out-of-range placeId with 400", async () => {
    const app = await buildTestApp({ fetchImpl: makeFetch().fetchImpl });
    const res = await app.inject({ method: "POST", url: "/api/quests", payload: { ...CREATE, placeId: 0 } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe("GET /api/quests/:id", () => {
  it("reopens a quest and re-ranks its targets for the current month", async () => {
    const { fetchImpl, calls } = makeFetch({ species: speciesFixture(40, 5000), observerCount: 4 });
    const june = () => Date.UTC(2026, 5, 1);
    const app = await buildTestApp({ fetchImpl, now: june, config: testConfig({ observerEnrichTopK: 3 }) });
    const created = await app.inject({ method: "POST", url: "/api/quests", payload: CREATE });
    const id = created.json().quest.id;

    const reopen = await app.inject({ method: "GET", url: `/api/quests/${id}?page=1` });
    expect(reopen.statusCode).toBe(200);
    expect(reopen.json().quest.seasonMonth).toBe(6);
    expect(reopen.json().results.length).toBeGreaterThan(0);
    // The month passed upstream is always June, on create and on reopen.
    expect(calls.speciesMonths.every((m) => m === "6")).toBe(true);
    await app.close();
  });

  it("serves repeat opens from cache, hitting species_counts once", async () => {
    const { fetchImpl, calls } = makeFetch({ species: speciesFixture(50, 5000), observerCount: 4 });
    const app = await buildTestApp({ fetchImpl, config: testConfig({ observerEnrichTopK: 3 }) });
    const created = await app.inject({ method: "POST", url: "/api/quests", payload: CREATE });
    const id = created.json().quest.id;
    await app.inject({ method: "GET", url: `/api/quests/${id}?page=1` });
    await app.inject({ method: "GET", url: `/api/quests/${id}?page=2` });
    await app.inject({ method: "GET", url: `/api/quests/${id}` });
    expect(calls.species).toBe(1);
    await app.close();
  });

  it("returns 404 for an unknown quest id", async () => {
    const app = await buildTestApp({ fetchImpl: makeFetch().fetchImpl });
    const res = await app.inject({ method: "GET", url: "/api/quests/22222222-2222-4222-8222-222222222222" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "not_found", message: "That quest is not here." });
    await app.close();
  });

  it("rejects a non-UUID id with 400", async () => {
    const app = await buildTestApp({ fetchImpl: makeFetch().fetchImpl });
    const res = await app.inject({ method: "GET", url: "/api/quests/not-a-uuid" });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe("GET /api/quests (list)", () => {
  it("returns an empty list for an unknown username, not an error", async () => {
    const app = await buildTestApp({ fetchImpl: makeFetch().fetchImpl });
    const res = await app.inject({ method: "GET", url: "/api/quests?login=nobodyhere" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ quests: [] });
    await app.close();
  });

  it("lists from the store only, making no upstream call", async () => {
    const { fetchImpl, calls } = makeFetch({ species: speciesFixture(5, 50) });
    const app = await buildTestApp({ fetchImpl });
    await app.inject({ method: "POST", url: "/api/quests", payload: CREATE });
    const before = calls.species;
    await app.inject({ method: "GET", url: "/api/quests?login=kueda" });
    expect(calls.species).toBe(before);
    await app.close();
  });
});

describe("DELETE /api/quests/:id", () => {
  it("deletes only with a matching login", async () => {
    const app = await buildTestApp({ fetchImpl: makeFetch({ species: speciesFixture(3, 30) }).fetchImpl });
    const created = await app.inject({ method: "POST", url: "/api/quests", payload: CREATE });
    const id = created.json().quest.id;

    const wrong = await app.inject({ method: "DELETE", url: `/api/quests/${id}?login=someoneelse` });
    expect(wrong.statusCode).toBe(404);

    const ok = await app.inject({ method: "DELETE", url: `/api/quests/${id}?login=kueda` });
    expect(ok.statusCode).toBe(204);

    const list = await app.inject({ method: "GET", url: "/api/quests?login=kueda" });
    expect(list.json().quests).toHaveLength(0);
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
    const res = await app.inject({ method: "POST", url: "/api/quests", payload: CREATE });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "server_error", message: "Try again in a moment." });
    expect(sdk.captureException).toHaveBeenCalledTimes(1);
    const captured = JSON.stringify(sdk.captureException.mock.calls[0]?.[0] ?? {});
    expect(captured).not.toContain("kueda");
    expect(res.body).not.toContain("at ");
    await app.close();
  });
});
