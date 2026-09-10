import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The frontend lives in web/ and builds to dist/web, which the Fastify
// server serves as static assets from the same origin.
export default defineConfig({
  root: "web",
  plugins: [react()],
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8080",
    },
  },
});
