import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();

const app = await buildApp({ config });

try {
  await app.listen({ port: config.port, host: "0.0.0.0" });
  console.log(`naturalist-quest-map listening on :${config.port}`);
} catch (err) {
  console.error("Failed to start:", err);
  process.exit(1);
}
