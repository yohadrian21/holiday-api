import type { Tier } from "./config";

export interface Env {
  DB: D1Database;
  RAPIDAPI_PROXY_SECRET?: string;
  /** Workers Rate Limiting bindings (wrangler.toml [[ratelimits]]). Optional: absent -> in-memory fallback. */
  BURST_FREE?: RateLimit;
  BURST_STARTER?: RateLimit;
  BURST_BUSINESS?: RateLimit;
}

export type AuthInfo =
  | { kind: "key"; keyId: string; tier: Tier }
  | { kind: "rapidapi" };

export type AppEnv = { Bindings: Env; Variables: { auth: AuthInfo } };
