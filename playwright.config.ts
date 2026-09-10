import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 1, // sanctioned shared-host allowance
  timeout: 60_000, // per-test floor
  expect: { timeout: 15_000 }, // web-first assertion floor
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 15_000,
    launchOptions: { args: ["--no-sandbox"] },
  },
  webServer: {
    // Production build under test: build the frontend, then run the app with
    // a local iNat stub (e2e/serve.ts). Never a dev server.
    command: "npm run build && npm run start:e2e",
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000, // build + warm-up headroom
    env: {
      E2E_PORT: String(PORT),
      NODE_ENV: "production",
    },
  },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }],
});
