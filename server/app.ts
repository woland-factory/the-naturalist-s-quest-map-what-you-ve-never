import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import compress from "@fastify/compress";
import fastifyStatic from "@fastify/static";
import { loadConfig, type AppConfig } from "./config.js";
import { createCache, type Cache } from "./cache.js";
import { INatClient, RateLimiter } from "./inat/client.js";
import { createErrorTracker, type ErrorTracker, type SentryLike } from "./observability.js";
import { seedDemo } from "./seed.js";
import { registerHealth } from "./routes/health.js";
import { registerConfig } from "./routes/config.js";
import { registerUsers } from "./routes/users.js";
import { registerPlaces } from "./routes/places.js";
import { registerTargets } from "./routes/targets.js";

export interface BuildOptions {
  config?: AppConfig;
  cache?: Cache;
  client?: INatClient;
  tracker?: ErrorTracker;
  sentrySdk?: SentryLike;
  serveStatic?: boolean; // default true; tests turn it off
}

const here = dirname(fileURLToPath(import.meta.url));

export async function buildApp(options: BuildOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const cache = options.cache ?? createCache(config.cacheMaxEntries);
  const client =
    options.client ??
    new INatClient({
      apiBase: config.inatApiBase,
      userAgent: config.inatUserAgent,
      timeoutMs: config.inatTimeoutMs,
      rateLimiter: new RateLimiter(config.inatRateLimitRps),
      cache,
      userTtlSeconds: config.userTtlSeconds,
      placeTtlSeconds: config.placeTtlSeconds,
      targetsTtlSeconds: config.targetsTtlSeconds,
    });
  const tracker = options.tracker ?? createErrorTracker(config, options.sentrySdk);
  await tracker.init();

  const app = Fastify({
    logger: false,
  });

  await app.register(rateLimit, {
    global: true,
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindow,
    // Keep the limiter's own error copy in the product's voice.
    errorResponseBuilder: () => ({
      error: "rate_limited",
      message: "Too many requests. Wait a moment and try again.",
    }),
  });

  await app.register(compress, { global: true, encodings: ["gzip", "deflate"] });

  // One clean error surface. Validation failures become an actionable 400;
  // anything unexpected is captured (no PII) and returns a plain 500. No
  // stack trace or upstream body ever reaches the client.
  app.setErrorHandler((err: Error & { validation?: unknown; statusCode?: number }, _req, reply) => {
    if (err.validation) {
      return reply.code(400).send({ error: "bad_request", message: "Check the form and try again." });
    }
    const statusCode = err.statusCode;
    if (statusCode && statusCode < 500) {
      return reply.code(statusCode).send({ error: "bad_request", message: err.message });
    }
    tracker.captureException(err);
    return reply.code(500).send({ error: "server_error", message: "Try again in a moment." });
  });

  registerHealth(app);
  registerConfig(app, config);
  registerUsers(app, client);
  registerPlaces(app, client);
  registerTargets(app, { client, cache, config });

  if (config.seedDemo) {
    seedDemo(cache, config);
  }

  const serveStatic = options.serveStatic ?? true;
  if (serveStatic) {
    const webRoot = resolveWebRoot();
    if (webRoot) {
      await app.register(fastifyStatic, { root: webRoot, wildcard: false });
      // SPA fallback: any non-API GET that is not a static file serves the
      // app shell so client routing works and a deep link never 404s.
      app.setNotFoundHandler((req, reply) => {
        if (req.method === "GET" && !req.url.startsWith("/api/")) {
          return reply.type("text/html").sendFile("index.html");
        }
        return reply.code(404).send({ error: "not_found", message: "That page is not here." });
      });
    }
  }

  return app;
}

function resolveWebRoot(): string | null {
  // dist/web relative to the built layout; tolerate running from source.
  const candidates = [join(here, "..", "dist", "web"), join(process.cwd(), "dist", "web")];
  for (const c of candidates) {
    if (existsSync(join(c, "index.html"))) return c;
  }
  return null;
}
