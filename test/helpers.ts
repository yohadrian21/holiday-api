import { env, SELF } from "cloudflare:test";
import { quotaPeriod, sha256Hex } from "../src/auth";
import type { Tier } from "../src/config";

/** Synthetic test data for fake years 2098 (supported, no holidays) and 2099. */
export async function seedFakeYears(): Promise<void> {
  const src = ["TEST-DECREE", "https://example.invalid/test-decree"];
  const hol = (date: string, name: string, type: string) =>
    env.DB.prepare(
      "INSERT OR IGNORE INTO holidays (date, year, name_id, name_en, type, source_ref, source_url, data_version) VALUES (?, 2099, ?, ?, ?, ?, ?, 'test-2099.1')",
    ).bind(date, `Uji ${name}`, `Test ${name}`, type, ...src);
  await env.DB.batch([
    env.DB.prepare("INSERT OR REPLACE INTO data_versions VALUES ('test-2098.1', 2098, ?, ?, '2098-01-01T00:00:00Z', 'test')").bind(...src),
    env.DB.prepare("INSERT OR REPLACE INTO data_versions VALUES ('test-2099.1', 2099, ?, ?, '2099-01-01T00:00:00Z', 'test')").bind(...src),
    hol("2099-01-01", "New Year", "national"), // Thu
    hol("2099-01-02", "Cuti", "cuti_bersama"), // Fri
    hol("2099-01-03", "Saturday Holiday", "national"), // Sat
  ]);
}

/** Inserts a fresh key and returns { id, key }. */
export async function createKey(tier: Tier = "business", opts: { revoked?: boolean; used?: number } = {}) {
  const id = crypto.randomUUID();
  const key = `ika_test_${id.replaceAll("-", "")}`;
  await env.DB.prepare("INSERT INTO api_keys (id, key_hash, key_prefix, name, tier, revoked_at) VALUES (?, ?, ?, 'test', ?, ?)")
    .bind(id, await sha256Hex(key), key.slice(0, 13), tier, opts.revoked ? "2026-01-01T00:00:00Z" : null)
    .run();
  if (opts.used !== undefined) {
    await env.DB.prepare("INSERT INTO usage (key_id, period, count) VALUES (?, ?, ?)").bind(id, quotaPeriod(Date.now()).period, opts.used).run();
  }
  return { id, key };
}

export function get(path: string, headers: Record<string, string> = {}) {
  return SELF.fetch(`https://api.test${path}`, { headers });
}

export async function getJson<T = any>(path: string, key: string) {
  const res = await get(path, { "X-API-Key": key });
  return { res, status: res.status, body: (await res.json()) as T };
}
