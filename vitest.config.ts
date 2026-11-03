import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";
import { loadSeedYears } from "./scripts/lib/seed.ts";

export default defineConfig(async () => ({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations("./migrations"),
          // Real data from data/holidays/*.json (may be empty); validated on load.
          TEST_SEED: loadSeedYears("./data/holidays"),
          RAPIDAPI_PROXY_SECRET: "test-rapidapi-secret",
          // Raw wrangler.toml, to check [[ratelimits]] stay in sync with TIERS.
          TEST_WRANGLER_TOML: readFileSync("./wrangler.toml", "utf8"),
        },
      },
    }),
  ],
  test: { setupFiles: ["./test/setup.ts"] },
}));
