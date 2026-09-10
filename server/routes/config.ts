import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config.js";

// Public runtime config for the frontend. Contains only values that are
// public by design (Umami website id, the frontend Sentry DSN) plus the
// demo descriptor when SEED_DEMO is on. Never any secret.
export function registerConfig(app: FastifyInstance, config: AppConfig): void {
  app.get("/api/config", async () => {
    const body: Record<string, unknown> = {};
    if (config.umamiWebsiteId && config.umamiUrl) {
      body.umamiWebsiteId = config.umamiWebsiteId;
      body.umamiUrl = config.umamiUrl;
    }
    if (config.sentryDsn) {
      body.sentryDsn = config.sentryDsn;
    }
    if (config.seedDemo) {
      body.demo = {
        login: config.seedDemoLogin,
        placeId: config.seedDemoPlaceId,
        placeName: config.seedDemoPlaceName,
        month: config.seedDemoMonth,
      };
    }
    return body;
  });
}
