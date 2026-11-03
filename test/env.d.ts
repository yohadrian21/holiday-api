import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import type { SeedYear } from "../scripts/lib/seed.ts";
import type { Env as AppBindings } from "../src/types";

declare global {
  namespace Cloudflare {
    interface Env extends AppBindings {
      TEST_MIGRATIONS: D1Migration[];
      TEST_SEED: SeedYear[];
      TEST_WRANGLER_TOML: string;
    }
  }
}
