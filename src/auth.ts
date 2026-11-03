import type { MiddlewareHandler } from "hono";
import { BURST_PERIOD_S, JAKARTA_OFFSET_MS, RAPIDAPI_BUCKET, TIERS, type Tier } from "./config";
import { ApiError } from "./errors";
import type { AppEnv, Env } from "./types";

const encoder = new TextEncoder();

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", encoder.encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string comparison (hash first so lengths always match). */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([a, b].map((s) => crypto.subtle.digest("SHA-256", encoder.encode(s))));
  return crypto.subtle.timingSafeEqual(ha!, hb!);
}

/** Current quota period ('YYYY-MM' in Asia/Jakarta) and the Unix time (s) at which it resets. */
export function quotaPeriod(nowMs: number): { period: string; resetEpoch: number } {
  const local = new Date(nowMs + JAKARTA_OFFSET_MS);
  const nextMonthStart = Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1) - JAKARTA_OFFSET_MS;
  return { period: local.toISOString().slice(0, 7), resetEpoch: Math.floor(nextMonthStart / 1000) };
}

const BURST_BINDING = {
  free: "BURST_FREE",
  starter: "BURST_STARTER",
  business: "BURST_BUSINESS",
} as const satisfies Record<Tier, keyof Env>;

/**
 * Fallback burst limiter (fixed BURST_PERIOD_S-second window, in memory per isolate), used only when the
 * tier's Rate Limiting binding is absent (e.g. some test setups). Not global across isolates.
 */
const burst = new Map<string, { window: number; count: number }>();
export function allowBurstInMemory(keyId: string, limit: number, nowMs: number): boolean {
  const window = Math.floor(nowMs / (BURST_PERIOD_S * 1000));
  const b = burst.get(keyId);
  if (!b || b.window !== window) {
    burst.set(keyId, { window, count: 1 });
    return true;
  }
  if (b.count >= limit) return false;
  b.count++;
  return true;
}

/**
 * Burst check via the Workers Rate Limiting binding (shared across isolates within a Cloudflare
 * location; approximate, eventually consistent), falling back to the in-memory limiter.
 */
async function allowBurst(env: Env, tier: Tier, keyId: string, nowMs: number): Promise<boolean> {
  const binding = env[BURST_BINDING[tier]];
  if (binding) return (await binding.limit({ key: keyId })).success;
  return allowBurstInMemory(keyId, TIERS[tier].burstPer10s, nowMs);
}

const UNAUTH = (code: string, message: string) => new ApiError(401, code, message);

export const auth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const db = c.env.DB;
  const now = Date.now();
  const { period, resetEpoch } = quotaPeriod(now);

  // RapidAPI path: the gateway authenticates and meters; we only verify the proxy secret.
  const proxySecret = c.req.header("X-RapidAPI-Proxy-Secret");
  if (proxySecret !== undefined) {
    const expected = c.env.RAPIDAPI_PROXY_SECRET ?? "";
    if (!expected || !(await safeEqual(proxySecret, expected))) {
      throw UNAUTH("invalid_proxy_secret", "Invalid X-RapidAPI-Proxy-Secret.");
    }
    c.set("auth", { kind: "rapidapi" });
    c.executionCtx.waitUntil(
      db
        .prepare(
          "INSERT INTO usage (key_id, period, count) VALUES (?, ?, 1) ON CONFLICT (key_id, period) DO UPDATE SET count = count + 1",
        )
        .bind(RAPIDAPI_BUCKET, period)
        .run()
        .catch(() => {}),
    );
    return next();
  }

  const key = c.req.header("X-API-Key");
  if (!key) throw UNAUTH("missing_api_key", "Missing X-API-Key header.");
  const row = await db
    .prepare("SELECT id, tier, revoked_at FROM api_keys WHERE key_hash = ?")
    .bind(await sha256Hex(key))
    .first<{ id: string; tier: Tier; revoked_at: string | null }>();
  if (!row) throw UNAUTH("invalid_api_key", "Invalid API key.");
  if (row.revoked_at) throw UNAUTH("revoked_api_key", "This API key has been revoked.");

  const tier = TIERS[row.tier];
  const limit = tier.monthly;
  const rlHeaders = (remaining: number | null) => ({
    "X-RateLimit-Limit": limit === null ? "unlimited" : String(limit),
    "X-RateLimit-Remaining": remaining === null ? "unlimited" : String(Math.max(0, remaining)),
    "X-RateLimit-Reset": String(resetEpoch),
  });

  if (!(await allowBurst(c.env, row.tier, row.id, now))) {
    const used = await db
      .prepare("SELECT count FROM usage WHERE key_id = ? AND period = ?")
      .bind(row.id, period)
      .first<number>("count");
    throw new ApiError(429, "rate_limited", `Burst limit of ${tier.burstPer10s} requests per ${BURST_PERIOD_S} seconds exceeded.`, {
      ...rlHeaders(limit === null ? null : limit - (used ?? 0)),
      "Retry-After": String(BURST_PERIOD_S),
    });
  }

  // Atomic increment; the conditional upsert returns no row once the quota is exhausted.
  const count = await db
    .prepare(
      `INSERT INTO usage (key_id, period, count) VALUES (?1, ?2, 1)
       ON CONFLICT (key_id, period) DO UPDATE SET count = count + 1 WHERE ?3 IS NULL OR count < ?3
       RETURNING count`,
    )
    .bind(row.id, period, limit)
    .first<number>("count");
  if (count === null) {
    throw new ApiError(429, "quota_exceeded", `Monthly quota of ${limit} requests exceeded; resets at start of next month (Asia/Jakarta).`, {
      ...rlHeaders(0),
      "Retry-After": String(Math.max(1, resetEpoch - Math.floor(now / 1000))),
    });
  }

  c.set("auth", { kind: "key", keyId: row.id, tier: row.tier });
  for (const [k, v] of Object.entries(rlHeaders(limit === null ? null : limit - count))) c.header(k, v);
  return next();
};
