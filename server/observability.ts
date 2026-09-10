import type { AppConfig } from "./config.js";

// Thin seam over the error tracker so routes and tests never depend on the
// concrete SDK. When SENTRY_DSN is unset every method is a no-op and the
// app runs untouched. We never attach the username or any other PII to an
// event: captureException receives the error and nothing else.

export interface SentryLike {
  init(opts: Record<string, unknown>): void;
  captureException(err: unknown): void;
}

export interface ErrorTracker {
  enabled: boolean;
  init(): Promise<void>;
  captureException(err: unknown): void;
}

export function createErrorTracker(config: AppConfig, sdk?: SentryLike): ErrorTracker {
  const enabled = config.sentryDsn.trim().length > 0;
  let loaded: SentryLike | null = null;

  return {
    enabled,
    async init() {
      if (!enabled) return;
      // Loaded lazily so an app booted without SENTRY_DSN never pays for it.
      const sentry = sdk ?? ((await import("@sentry/node")) as unknown as SentryLike);
      sentry.init({
        dsn: config.sentryDsn,
        // No PII: do not send default request/user data.
        sendDefaultPii: false,
      });
      loaded = sentry;
    },
    captureException(err: unknown) {
      if (!enabled || !loaded) return;
      loaded.captureException(err);
    },
  };
}
