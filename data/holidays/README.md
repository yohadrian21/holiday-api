# Holiday data files

One file per year: `data/holidays/<year>.json`. Adding a year = adding one file, then
`npm run db:seed` (regenerates `seed/seed.sql` and applies it locally). Re-seeding is
idempotent: each year's rows are deleted and re-inserted.

Only enter data copied from official decrees (SKB 3 Menteri on libur nasional & cuti bersama,
and any revisions). Do not guess dates (e.g. moon-sighting-dependent holidays) before the decree.

## Format

```json
{
  "year": 2027,
  "data_version": "2027.1",
  "updated_at": "2026-10-01T00:00:00Z",
  "decrees": [
    { "ref": "SKB <number/ministries/year>", "url": "https://<official source>" }
  ],
  "revisions": [
    { "version": "2027.1", "date": "2026-10-01", "notes": "Initial SKB" }
  ],
  "notes": "optional; defaults to the last revision's notes",
  "entries": [
    {
      "date": "2027-MM-DD",
      "name_id": "<nama resmi>",
      "name_en": "<English name>",
      "type": "national",
      "source_ref": "optional; defaults to decrees[0].ref",
      "source_url": "optional; defaults to decrees[0].url"
    }
  ]
}
```

| Field | Rules |
|---|---|
| `year` | Integer; must match the file name. |
| `data_version` | Free-form string, bump on every change (e.g. `2027.2` after a revised SKB). Exposed as `meta.data_version`. |
| `updated_at` | ISO 8601 timestamp; the latest across all years is exposed as `meta.updated_at`. |
| `decrees` | Non-empty; every decree/revision that the entries rely on. |
| `entries[].type` | `national` (libur nasional) or `cuti_bersama`. |
| `entries[].date` | `YYYY-MM-DD`, must be a real date inside `year`. Multiple entries on the same date are allowed. |

A year with a file but zero entries is still "supported" (API answers instead of 422).
`scripts/build-seed.ts` validates every file and fails loudly on errors; the test suite
loads the same files, so `npm test` also validates them.
