import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { allowBurstInMemory, quotaPeriod } from "../src/auth";
import { BURST_PERIOD_S, TIERS } from "../src/config";
import { createKey, get, seedFakeYears } from "./helpers";

const PATH = "/v1/working-day?date=2099-01-05";
beforeAll(seedFakeYears);

async function errorCode(res: Response) {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

describe("API key auth", () => {
  it("401 missing key", async () => {
    const res = await get(PATH);
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe("missing_api_key");
  });
  it("401 invalid key", async () => {
    const res = await get(PATH, { "X-API-Key": "ika_live_doesnotexist" });
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe("invalid_api_key");
  });
  it("401 revoked key", async () => {
    const { key } = await createKey("free", { revoked: true });
    const res = await get(PATH, { "X-API-Key": key });
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe("revoked_api_key");
  });
});

describe("quota & rate-limit headers", () => {
  it("sends X-RateLimit-* and increments usage atomically", async () => {
    const { id, key } = await createKey("free");
    const r1 = await get(PATH, { "X-API-Key": key });
    expect(r1.status).toBe(200);
    expect(r1.headers.get("X-RateLimit-Limit")).toBe("1000");
    expect(r1.headers.get("X-RateLimit-Remaining")).toBe("999");
    expect(r1.headers.get("X-RateLimit-Reset")).toBe(String(quotaPeriod(Date.now()).resetEpoch));
    const r2 = await get(PATH, { "X-API-Key": key });
    expect(r2.headers.get("X-RateLimit-Remaining")).toBe("998");
    const row = await env.DB.prepare("SELECT count FROM usage WHERE key_id = ?").bind(id).first<number>("count");
    expect(row).toBe(2);
  });
  it("headers also present on 4xx responses after auth", async () => {
    const { key } = await createKey("starter");
    const res = await get("/v1/working-day?date=bad", { "X-API-Key": key });
    expect(res.status).toBe(400);
    expect(res.headers.get("X-RateLimit-Limit")).toBe("50000");
  });
  it("business tier reports unlimited", async () => {
    const { key } = await createKey("business");
    const res = await get(PATH, { "X-API-Key": key });
    expect(res.headers.get("X-RateLimit-Limit")).toBe("unlimited");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("unlimited");
  });
  it("429 quota_exceeded when free key counter is at 1000", async () => {
    const { id, key } = await createKey("free", { used: 1000 });
    const res = await get(PATH, { "X-API-Key": key });
    expect(res.status).toBe(429);
    expect(await errorCode(res)).toBe("quota_exceeded");
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("0");
    // rejected requests do not inflate the counter
    expect(await env.DB.prepare("SELECT count FROM usage WHERE key_id = ?").bind(id).first<number>("count")).toBe(1000);
  });
  it("429 rate_limited on burst (Rate Limiting binding)", async () => {
    // Miniflare provides the [[ratelimits]] bindings from wrangler.toml.
    expect(env.BURST_FREE).toBeDefined();
    const { key } = await createKey("free"); // 50 per 10 s
    const limit = TIERS.free.burstPer10s;
    // Fixed windows: a burst spans at most 2 windows -> at most 2*limit allowed, so 2*limit+10 must hit 429.
    const res = await Promise.all(Array.from({ length: 2 * limit + 10 }, () => get(PATH, { "X-API-Key": key })));
    const limited = res.filter((r) => r.status === 429);
    expect(limited.length).toBeGreaterThan(0);
    expect(res.filter((r) => r.status === 200).length).toBeGreaterThanOrEqual(limit);
    expect(await errorCode(limited[0]!)).toBe("rate_limited");
    expect(limited[0]!.headers.get("Retry-After")).toBe("10");
    expect(limited[0]!.headers.get("X-RateLimit-Limit")).toBe("1000");
    expect(((await limited[1]!.json()) as { error: { message: string } }).error.message).toBe(
      "Burst limit of 50 requests per 10 seconds exceeded.",
    );
  });
});

describe("in-memory burst fallback", () => {
  const W = BURST_PERIOD_S * 1000;
  it("allows `limit` per 10 s window, then rejects", () => {
    const t0 = 1_000 * W; // window start
    for (let i = 0; i < 50; i++) expect(allowBurstInMemory("fb-1", 50, t0 + i)).toBe(true);
    expect(allowBurstInMemory("fb-1", 50, t0 + W - 1)).toBe(false);
    expect(allowBurstInMemory("fb-1", 50, t0 + W)).toBe(true); // next window resets
  });
  it("tracks keys independently", () => {
    const t0 = 2_000 * W;
    expect(allowBurstInMemory("fb-a", 1, t0)).toBe(true);
    expect(allowBurstInMemory("fb-a", 1, t0)).toBe(false);
    expect(allowBurstInMemory("fb-b", 1, t0)).toBe(true);
  });
});

describe("burst config", () => {
  it("wrangler.toml [[ratelimits]] match TIERS.burstPer10s", () => {
    const toml = env.TEST_WRANGLER_TOML;
    const want = { BURST_FREE: TIERS.free.burstPer10s, BURST_STARTER: TIERS.starter.burstPer10s, BURST_BUSINESS: TIERS.business.burstPer10s };
    for (const [name, limit] of Object.entries(want)) {
      const re = new RegExp(`name = "${name}"[\\s\\S]*?simple = \\{ limit = (\\d+), period = (\\d+) \\}`);
      const m = toml.match(re);
      expect(m, name).not.toBeNull();
      expect(Number(m![1])).toBe(limit);
      expect(Number(m![2])).toBe(BURST_PERIOD_S);
    }
  });
});

describe("RapidAPI proxy", () => {
  it("valid secret skips API key and quota", async () => {
    const res = await get(PATH, { "X-RapidAPI-Proxy-Secret": "test-rapidapi-secret" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { is_working_day: boolean }).is_working_day).toBe(true);
  });
  it("invalid secret -> 401 even with a valid API key", async () => {
    const { key } = await createKey("business");
    const res = await get(PATH, { "X-RapidAPI-Proxy-Secret": "wrong", "X-API-Key": key });
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe("invalid_proxy_secret");
  });
});
