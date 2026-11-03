/**
 * Manage API keys in D1 (local by default; add --remote for the deployed DB).
 *   npm run key:create -- --name foo --tier free [--remote]
 *   npm run key:revoke -- --id <key id> | --prefix <key prefix> [--remote]
 * The raw key is printed once; only its SHA-256 hash is stored.
 */
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

const TIERS = ["free", "starter", "business"];
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function randomBase62(len: number): string {
  let out = "";
  while (out.length < len) {
    for (const b of randomBytes(len * 2)) {
      if (b < 248 && out.length < len) out += BASE62[b % 62]; // 248 = 4*62: rejection sampling, no bias
    }
  }
  return out;
}

const sq = (s: string) => `'${s.replaceAll("'", "''")}'`;

function d1(sql: string, remote: boolean): void {
  execFileSync("npx", ["wrangler", "d1", "execute", "DB", remote ? "--remote" : "--local", "--command", sql], {
    stdio: ["ignore", "ignore", "inherit"],
  });
}

const [command, ...rest] = process.argv.slice(2);
const { values } = parseArgs({
  args: rest,
  options: {
    name: { type: "string" },
    tier: { type: "string", default: "free" },
    id: { type: "string" },
    prefix: { type: "string" },
    remote: { type: "boolean", default: false },
  },
});

if (command === "create") {
  if (!values.name) throw new Error("--name is required");
  if (!TIERS.includes(values.tier!)) throw new Error(`--tier must be one of ${TIERS.join(", ")}`);
  const key = `ika_live_${randomBase62(32)}`;
  const id = randomUUID();
  const hash = createHash("sha256").update(key).digest("hex");
  const prefix = key.slice(0, 13);
  d1(
    `INSERT INTO api_keys (id, key_hash, key_prefix, name, tier) VALUES (${[id, hash, prefix, values.name, values.tier!].map(sq).join(", ")})`,
    values.remote!,
  );
  console.log(`Created key id=${id} tier=${values.tier} name=${values.name}`);
  console.log(`\n  ${key}\n\nStore it now; it will not be shown again.`);
} else if (command === "revoke") {
  const where = values.id ? `id = ${sq(values.id)}` : values.prefix ? `key_prefix = ${sq(values.prefix)}` : null;
  if (!where) throw new Error("--id or --prefix is required");
  d1(`UPDATE api_keys SET revoked_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE ${where} AND revoked_at IS NULL`, values.remote!);
  console.log(`Revoked key(s) where ${where}`);
} else {
  console.error("Usage: create-key.ts create --name <n> --tier free|starter|business [--remote]\n       create-key.ts revoke --id <id> | --prefix <prefix> [--remote]");
  process.exit(1);
}
