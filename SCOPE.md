# Scope — holiday-api

_Status as of 2026-11-03._

## Built in v0.1 (local only)

- Cloudflare Worker (Hono + D1) with 5 endpoints: `/v1/health`, `/v1/holidays`, `/v1/working-day`, `/v1/business-days/add` and `/v1/working-days/count`. All support the `cuti_bersama=include|exclude` and `week=5|6` options.
- Real, verified data for 2024–2027 from the SKB 3 Menteri decrees, including the revisions. Every response includes `meta.data_version` and `meta.updated_at`. Any year without data returns 422 rather than a guess.
- API-key auth (keys stored as SHA-256 hashes) and three tiers (free, starter, business). The monthly quota is exact (atomic in D1). Burst limits use the Workers Rate Limiting binding (per 10-second window, per Cloudflare location, approximate). Responses carry rate-limit headers, and limits return 429 errors with `Retry-After`.
- RapidAPI proxy-secret path, with usage counted in a single bucket.
- CLI scripts to create and revoke keys, and a seed pipeline that turns the JSON data into SQL and validates it.
- `openapi.yaml`, a test suite that runs in the Workers runtime (including ground-truth checks on the real data), and strict TypeScript.

## Remaining for production

None of the following has been done, except #5 (burst limiting, done in code).

| # | Item | Owner | Est. |
|---|---|---|---|
| 1 | Cloudflare account and domain | Yohanes | 1 d (waiting on access) |
| 2 | Create the D1 database (`wrangler d1 create holiday-api`), set `database_id` in `wrangler.toml`, apply the migrations and seed with `--remote` | dev | 0.5 d |
| 3 | Set `RAPIDAPI_PROXY_SECRET` with `wrangler secret put` | dev | <0.5 d |
| 4 | Deploy with `wrangler deploy`, add a custom domain route and run smoke tests | dev | 0.5 d |
| 5 | ~~Production-grade burst limiting~~ **Done (local code):** Workers Rate Limiting binding, one `[[ratelimits]]` per tier in `wrangler.toml` (50/200/500 per 10 s), in-memory fallback if a binding is absent. Counting is per Cloudflare location and approximate; use a Durable Object per key if exact global limits are ever required. Takes effect on deploy (#4). | dev | done |
| 6 | Self-serve key provisioning tied to billing (Xendit/Midtrans), with tier upgrades and key rotation | Jonopm (+ dev) | 3–5 d |
| 7 | RapidAPI listing: plans, pricing, and import of `openapi.yaml` | Jonopm | 1–2 d |
| 8 | Docs and landing page generated from `openapi.yaml` | Jonoapp | 2–3 d |
| 9 | Monitoring and logging: Workers Logs/Analytics, 5xx and quota alerts, uptime check | dev | 1 d |
| 10 | Legal review of how the decree data is used and redistributed, plus ToS and privacy policy | legal | parallel |
| 11 | Write down the yearly data update process. The SKB for the next year usually comes out around September. Watch for an SKB perubahan (revision) during the year, as in 2024 and 2025. Steps: edit or add the JSON, bump `data_version`/`updated_at`, run `db:seed --remote`. Assign an owner and a reminder. | ops | 0.5 d |
| — | Later: regional holidays (*libur daerah*) | — | out of scope |

## Timeline

Items 2–5 and 9 take about 4–5 dev days once item 1 is done. Items 6–8 run in parallel and take 1–1.5 weeks. Allowing a few days for buffer, review and the RapidAPI listing approval, a **2–3 week** target is realistic. The critical path is getting Cloudflare and domain access (item 1) and the billing integration (item 6).
