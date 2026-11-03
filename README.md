# holiday-api

> **TL;DR:** A REST API for Indonesian public holidays and business-day math (working-day checks, date + N business days, working days in a range), built on Cloudflare Workers + Hono + D1 with API-key auth, per-tier quotas, burst rate limiting, an OpenAPI spec and Vitest tests.

Indonesia public holiday & business-day API. It covers *libur nasional* and *cuti bersama* (collective leave) from the official SKB 3 Menteri decrees. It answers questions like "is this date a working day?", "what is date + N business days?" and "how many working days are in this range?".

Built with Cloudflare Workers, Hono and D1 (SQLite). v0.1 runs locally only and has not been deployed yet (see [SCOPE.md](SCOPE.md)). The full API spec is in [openapi.yaml](openapi.yaml).

## Requirements

- Node.js 22+ (required by wrangler 4; developed on Node 24) and npm
- No Cloudflare account is needed for local dev. `wrangler` runs in `--local` mode with an on-disk D1 under `.wrangler/`.

## Quick start

```bash
npm install
cp .dev.vars.example .dev.vars          # sets RAPIDAPI_PROXY_SECRET for local dev
npm run db:migrate                      # create tables in local D1
npm run db:seed                         # validate data/holidays/*.json -> seed/seed.sql -> local D1
npm run key:create -- --name me --tier free   # prints an ika_live_... key ONCE
npm run dev                             # http://localhost:8787
```

```bash
KEY=ika_live_xxxxxxxx
H="X-API-Key: $KEY"

# Health (no auth). Returns status + meta.data_version / meta.updated_at
curl localhost:8787/v1/health

# Holidays for a year; optional type=national|cuti_bersama
curl -H "$H" "localhost:8787/v1/holidays?year=2026"
curl -H "$H" "localhost:8787/v1/holidays?year=2026&type=cuti_bersama"

# Is a date a working day?
curl -H "$H" "localhost:8787/v1/working-day?date=2026-03-20"                        # false (cuti bersama Idul Fitri)
curl -H "$H" "localhost:8787/v1/working-day?date=2026-03-20&cuti_bersama=exclude"   # true
curl -H "$H" "localhost:8787/v1/working-day?date=2026-03-21&week=6"                 # 6-day week (only Sunday off)

# Add / subtract business days (|days| <= 1000; the start day is never counted; days=0 rolls forward to a working day)
curl -H "$H" "localhost:8787/v1/business-days/add?date=2024-04-05&days=3"           # 2024-04-18
curl -H "$H" "localhost:8787/v1/business-days/add?date=2026-03-25&days=-1&cuti_bersama=exclude"

# Count working days: either month=YYYY-MM or start+end (inclusive, max 3660 days)
curl -H "$H" "localhost:8787/v1/working-days/count?month=2026-03"                   # 17
curl -H "$H" "localhost:8787/v1/working-days/count?month=2026-03&week=6"            # 20
curl -H "$H" "localhost:8787/v1/working-days/count?start=2026-01-01&end=2026-12-31&cuti_bersama=exclude"
```

Common options:

- `cuti_bersama=include|exclude` (default `include`). `include` treats cuti bersama as a day off, which is the civil-service and common corporate practice. `exclude` treats it as a working day.
- `week=5|6` (default `5`). With `5`, Saturday and Sunday are off. With `6`, only Sunday is off.

Every 200 response includes `meta: { data_version, updated_at }` for the most recently updated data year. Errors have the shape `{ "error": { "code", "message" } }`. A date in a year with no loaded data returns **422 `year_not_supported`**, and so does a calculation that runs into such a year. The API never guesses.

## Auth & rate limits

Send your key in the `X-API-Key` header. Only the SHA-256 hash of each key is stored. To revoke a key, run `npm run key:revoke -- --id <id>` or `--prefix ika_live_xxxx`. Add `--remote` to either key script to target the deployed D1.

| Tier | Monthly quota | Burst |
|---|---|---|
| free | 1,000 | 50 req / 10 s |
| starter | 50,000 | 200 req / 10 s |
| business | unlimited | 500 req / 10 s |

Tiers are defined in `src/config.ts`. Burst limits are enforced with the [Workers Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/): one `[[ratelimits]]` binding per tier in `wrangler.toml` (`BURST_FREE`, `BURST_STARTER`, `BURST_BUSINESS`), keyed by API key ID. The binding only supports 10 s or 60 s periods, so limits are per 10-second window. `TIERS[tier].burstPer10s` must match the binding's `limit` (a test checks this). If a binding is missing, the Worker falls back to an in-memory per-isolate limiter with the same window. Quotas reset at the start of each calendar month in Asia/Jakarta time. Each response carries these headers:

```
X-RateLimit-Limit: 1000          # or "unlimited"
X-RateLimit-Remaining: 997
X-RateLimit-Reset: 1796058000    # Unix seconds, start of next month in WIB (here 2026-12-01 00:00 WIB)
```

When a limit is hit, the API returns 429 with a `Retry-After` header (`10` for burst, seconds until reset for quota):

```json
{ "error": { "code": "rate_limited", "message": "Burst limit of 50 requests per 10 seconds exceeded." } }
{ "error": { "code": "quota_exceeded", "message": "Monthly quota of 1000 requests exceeded; resets at start of next month (Asia/Jakarta)." } }
```

401 codes: `missing_api_key`, `invalid_api_key`, `revoked_api_key`, `invalid_proxy_secret`.

**RapidAPI path.** If a request carries `X-RapidAPI-Proxy-Secret`, it is checked in constant time against the `RAPIDAPI_PROXY_SECRET` secret. In that case `X-API-Key` is not required. RapidAPI handles its own auth and quotas, and we only count usage in a single `rapidapi` bucket. If the secret is empty or unset, every proxy request gets a 401.

## Data

Each year lives in one file, `data/holidays/<year>.json`. The format and validation rules are in [data/holidays/README.md](data/holidays/README.md). Every entry came from an official decree and was verified on 2026-11-03.

| Year | data_version | Counts (national / cuti bersama) | Decree(s) |
|---|---|---|---|
| 2024 | 2024.2 | 17 / 10 | SKB 855/3/4 Tahun 2023 ([setkab.go.id](https://setkab.go.id/inilah-skb-3-menteri-libur-nasional-dan-cuti-bersama-2024/)), revised by SKB 236/1/2 Tahun 2024 (name changes only; [PDF](https://www.kemenkopmk.go.id/sites/default/files/pengumuman/2024-02/SKB%20Perubahan%20Libur%20Nasional%20dan%20Cuti%20Bersama%202024%20_0.pdf)) |
| 2025 | 2025.2 | 17 / 11 | SKB 1017/2/2 Tahun 2024 ([PDF](https://www.kemenkopmk.go.id/sites/default/files/pengumuman/2024-10/SKB%203%20Menteri%20Libur%20Nasional%20dan%20Cuti%20Bersama%20Tahun%202025.pdf)), revised by SKB 933/1/3 Tahun 2025 (adds cuti bersama on 18 Aug 2025; [PDF](https://www.kemenkopmk.go.id/sites/default/files/artikel/2025-08/SKB%20Perubahan%20Libur%20Nasional%20dan%20Cuti%20Bersama%20Tahun%202025.pdf)) |
| 2026 | 2026.1 | 17 / 8 | SKB 1497/2/5 Tahun 2025 ([PDF](https://www.kemenkopmk.go.id/sites/default/files/pengumuman/2025-09/SKB%20Libur%20Nasional%20dan%20Cuti%20Bersama%20Tahun%202026.pdf), [setneg.go.id](https://setneg.go.id/baca/index/inilah_skb_3_menteri_libur_nasional_dan_cuti_bersama_2026)) |
| 2027 | 2027.1 | 18 / 8 | SKB 1205/3/2 Tahun 2026 ([PDF](https://jdih.kemnaker.go.id/asset/data_puu/2026skb003.pdf), [setneg.go.id](https://setneg.go.id/baca/index/inilah_skb_3_menteri_libur_nasional_dan_cuti_bersama_2027)) |

To **add a year** or **apply an SKB revision (SKB perubahan)**:

1. Add `data/holidays/<year>.json`, or edit the existing file. Enter only dates from the official decree. Add the decree to `decrees` and `revisions`.
2. Bump `data_version` (e.g. `2027.1` → `2027.2`) and set `updated_at` to now. `meta` reports the most recent `updated_at` across all years.
3. Run `npm run db:seed`. Re-seeding is idempotent because each year's rows are deleted and re-inserted. Run `npm test` too, since it validates the same files. For production, apply `seed/seed.sql` with `wrangler d1 execute DB --remote --file seed/seed.sql`.

## Testing

```bash
npm test             # vitest inside the Workers runtime (miniflare + local D1)
npx tsc --noEmit     # typecheck (also: npm run typecheck)
```

The suite covers date arithmetic (`businessDays.test.ts`), auth, quotas and the RapidAPI path (`auth.test.ts`), and endpoint behavior on synthetic years 2098/2099 (`api.test.ts`). It also checks ground-truth values against the real 2024–2027 data (`data.test.ts`): holiday counts, specific dates, monthly and yearly working-day totals, and business-day additions across year boundaries. Test setup migrates and seeds an in-memory D1 from `data/holidays/*.json`.

## Project layout

```
src/index.ts            app: CORS, /v1/health, auth middleware, error handling
src/routes.ts           /v1 endpoints + parameter validation
src/auth.ts             API key / RapidAPI auth, monthly quota, burst limiter
src/lib/businessDays.ts pure date math (Calendar, addBusinessDays, countDays)
src/db.ts               D1 queries (holidays + meta in one batch)
src/config.ts           tiers and limits
migrations/             D1 schema
data/holidays/          source-of-truth holiday JSON (one file per year)
scripts/                build-seed.ts (JSON -> seed/seed.sql), create-key.ts (key create/revoke)
seed/seed.sql           generated, do not edit
test/                   vitest suites + helpers
openapi.yaml            API spec
```

## Known limitations

- **Burst limiting is per Cloudflare location and approximate.** The Rate Limiting binding keeps counters locally in each Cloudflare location and is eventually consistent ([Cloudflare docs](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)), so a client spread across locations, or a sharp spike, can briefly exceed the configured burst limit. It is not meant for exact accounting. The monthly quota is enforced exactly with an atomic D1 upsert. If exact global burst limits are ever needed, use a Durable Object per key.
- The API covers national holidays and cuti bersama only. It does not include regional holidays (*libur daerah*), company-specific calendars or half days.
- Years without a data file return 422. Data for the following year depends on the SKB, which is usually published around September.
- `reason` in `/working-day` uses English names. The Indonesian names are in `holiday.name_id` and `holidays[].name_id`.
- `meta` is global (latest across years), not per year queried.
- Keys are issued only through the CLI. There is no self-serve sign-up and no billing integration yet.
- `wrangler.toml` has a placeholder `database_id`, so remote commands will not work until a real D1 database is created.
- `@cloudflare/vitest-pool-workers` prints a deprecation warning saying it was renamed to `@cloudflare/vitest-plugin`. Tests still pass, and migrating is a small follow-up.
