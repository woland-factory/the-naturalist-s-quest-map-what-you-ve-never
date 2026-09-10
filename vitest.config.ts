import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    globals: false,
    hookTimeout: 20000,
    testTimeout: 20000,
  },
});
