import { createServer } from "node:http";
import { buildApp } from "../server/app.js";
import { loadConfig } from "../server/config.js";

// E2E harness. Starts a local stub of the iNaturalist API so the real
// production app (built frontend + Fastify) runs end to end without ever
// touching the live upstream, then boots the app pointed at that stub with
// SEED_DEMO on. This is the production build under test; only iNat is stubbed.

const SENTINEL_UNKNOWN = "ghostuserzzz";

function json(res: import("node:http").ServerResponse, body: unknown) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

const species = Array.from({ length: 30 }, (_, i) => ({
  count: 800 - i * 20,
  taxon: {
    id: 5000 + i,
    name: `Genus species${i}`,
    preferred_common_name: `Mock Creature ${i + 1}`,
    default_photo: null,
  },
}));

const mock = createServer((req, res) => {
  const u = new URL(req.url ?? "/", "http://localhost");
  const q = u.searchParams.get("q") ?? "";
  if (u.pathname.endsWith("/users/autocomplete")) {
    if (q.toLowerCase() === SENTINEL_UNKNOWN) return json(res, { results: [] });
    return json(res, { results: [{ id: 42, login: q, name: q, icon_url: null }] });
  }
  if (u.pathname.endsWith("/places/autocomplete")) {
    return json(res, {
      results: [
        { id: 14, name: "California", display_name: "California, US" },
        { id: 1, name: "United States", display_name: "United States" },
      ],
    });
  }
  // Place details for map framing: a bounding box around California.
  if (/\/places\/\d+$/.test(u.pathname)) {
    return json(res, {
      results: [
        {
          id: 14,
          name: "California",
          display_name: "California, US",
          bounding_box_geojson: {
            type: "Polygon",
            coordinates: [[[-124.48, 32.53], [-114.13, 32.53], [-114.13, 42.01], [-124.48, 42.01], [-124.48, 32.53]]],
          },
        },
      ],
    });
  }
  // Taxon map tiles: 404 so the map's graceful fallback path is exercised
  // end to end without ever touching the live iNaturalist tile servers.
  if (u.pathname.includes("/grid/")) {
    res.writeHead(404);
    return res.end("not a tile");
  }
  if (u.pathname.endsWith("/observations/species_counts")) {
    return json(res, { total_results: 4210, results: species });
  }
  if (u.pathname.endsWith("/observations/observers")) {
    return json(res, { total_results: 30 + Math.floor(Math.random() * 40) });
  }
  res.writeHead(404);
  res.end("{}");
});

const port = Number(process.env.E2E_PORT ?? 3100);

mock.listen(0, "127.0.0.1", async () => {
  const address = mock.address();
  const mockPort = typeof address === "object" && address ? address.port : 0;
  process.env.INAT_API_BASE = `http://127.0.0.1:${mockPort}/v1`;
  process.env.INAT_RATE_LIMIT_RPS = "0"; // no throttling against the local stub
  process.env.SEED_DEMO = "1";
  process.env.PORT = String(port);

  const app = await buildApp({ config: loadConfig() });
  await app.listen({ port, host: "127.0.0.1" });
  console.log(`e2e app on :${port}, iNat stub on :${mockPort}`);
});
