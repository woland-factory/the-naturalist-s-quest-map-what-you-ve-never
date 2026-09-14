// Typed environment parsing with safe defaults. No secret ever has a
// default value baked in here; secrets are read as-is and left empty when
// unset so the app degrades instead of shipping a placeholder credential.

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function str(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw === "" ? fallback : raw;
}

function truthy(name: string): boolean {
  const raw = (process.env[name] ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export interface AppConfig {
  port: number;
  inatApiBase: string;
  inatRateLimitRps: number;
  inatUserAgent: string;
  inatTimeoutMs: number;
  userTtlSeconds: number;
  placeTtlSeconds: number;
  targetsTtlSeconds: number;
  maxTargets: number;
  pageSize: number;
  meltPollPerPage: number;
  meltPollTtlSeconds: number;
  observerEnrichTopK: number;
  requestEnrichBudgetMs: number;
  cacheMaxEntries: number;
  rateLimitMax: number;
  rateLimitWindow: string;
  targetsRateLimitMax: number;
  dataDir: string;
  maxQuestsPerUser: number;
  questsRateLimitMax: number;
  sentryDsn: string;
  umamiWebsiteId: string;
  umamiUrl: string;
  seedDemo: boolean;
  seedDemoLogin: string;
  seedDemoPlaceId: number;
  seedDemoPlaceName: string;
  seedDemoMonth: number;
}

export function loadConfig(): AppConfig {
  return {
    port: num("PORT", 8080),
    inatApiBase: str("INAT_API_BASE", "https://api.inaturalist.org/v1").replace(/\/+$/, ""),
    inatRateLimitRps: num("INAT_RATE_LIMIT_RPS", 1),
    inatUserAgent: str("INAT_USER_AGENT", "naturalist-quest-map (contact: you@example.com)"),
    inatTimeoutMs: num("INAT_TIMEOUT_MS", 8000),
    userTtlSeconds: num("USER_TTL_SECONDS", 3600),
    placeTtlSeconds: num("PLACE_TTL_SECONDS", 86400),
    targetsTtlSeconds: num("TARGETS_TTL_SECONDS", 86400),
    maxTargets: num("MAX_TARGETS", 500),
    pageSize: num("PAGE_SIZE", 20),
    meltPollPerPage: num("MELT_POLL_PER_PAGE", 200),
    meltPollTtlSeconds: num("MELT_POLL_TTL_SECONDS", 60),
    observerEnrichTopK: num("OBSERVER_ENRICH_TOP_K", 25),
    requestEnrichBudgetMs: num("REQUEST_ENRICH_BUDGET_MS", 30000),
    cacheMaxEntries: num("CACHE_MAX_ENTRIES", 500),
    rateLimitMax: num("RATE_LIMIT_MAX", 60),
    rateLimitWindow: str("RATE_LIMIT_WINDOW", "1 minute"),
    targetsRateLimitMax: num("TARGETS_RATE_LIMIT_MAX", 20),
    dataDir: str("DATA_DIR", "./data"),
    maxQuestsPerUser: num("MAX_QUESTS_PER_USER", 25),
    questsRateLimitMax: num("QUESTS_RATE_LIMIT_MAX", 15),
    sentryDsn: str("SENTRY_DSN", ""),
    umamiWebsiteId: str("UMAMI_WEBSITE_ID", ""),
    umamiUrl: str("UMAMI_URL", ""),
    seedDemo: truthy("SEED_DEMO"),
    seedDemoLogin: str("SEED_DEMO_LOGIN", "kueda"),
    seedDemoPlaceId: num("SEED_DEMO_PLACE_ID", 14),
    seedDemoPlaceName: str("SEED_DEMO_PLACE_NAME", "California"),
    seedDemoMonth: num("SEED_DEMO_MONTH", 9),
  };
}
