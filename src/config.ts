/**
 * All tunable limits live here. `monthly: null` = unlimited.
 * `burstPer10s` MUST match the `simple.limit` of the matching [[ratelimits]] binding in
 * wrangler.toml (BURST_FREE / BURST_STARTER / BURST_BUSINESS, period = 10 s). The binding
 * config is static, so changing a value here means changing wrangler.toml too.
 */
export const TIERS = {
  free: { monthly: 1000, burstPer10s: 50 },
  starter: { monthly: 50_000, burstPer10s: 200 },
  business: { monthly: null, burstPer10s: 500 },
} as const satisfies Record<string, { monthly: number | null; burstPer10s: number }>;

/** Burst window length in seconds (Rate Limiting binding period; must be 10 or 60). */
export const BURST_PERIOD_S = 10;

export type Tier = keyof typeof TIERS;

export const MAX_RANGE_DAYS = 3660;
export const MAX_ADD_DAYS = 1000;
/** Asia/Jakarta is UTC+7 with no DST. */
export const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;
/** usage.key_id bucket for requests arriving through the RapidAPI proxy. */
export const RAPIDAPI_BUCKET = "rapidapi";
