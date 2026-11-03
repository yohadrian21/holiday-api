import type { Holiday, HolidayType } from "./lib/businessDays";

export interface Meta {
  data_version: string | null;
  updated_at: string | null;
}

interface HolidayRow {
  date: string;
  name_id: string;
  name_en: string;
  type: HolidayType;
  source_ref: string;
  source_url: string;
}

export interface HolidayData {
  meta: Meta;
  supportedYears: Set<number>;
  holidays: Holiday[];
}

/** Loads data-version info plus holidays for [fromYear, toYear] in a single round trip. */
export async function loadHolidayData(db: D1Database, fromYear: number, toYear: number): Promise<HolidayData> {
  const [versions, rows] = await db.batch([
    db.prepare("SELECT version, year, updated_at FROM data_versions ORDER BY updated_at DESC, version DESC"),
    db
      .prepare(
        "SELECT date, name_id, name_en, type, source_ref, source_url FROM holidays WHERE year BETWEEN ? AND ? ORDER BY date, type, name_id",
      )
      .bind(fromYear, toYear),
  ]);
  const v = (versions?.results ?? []) as { version: string; year: number; updated_at: string }[];
  const latest = v[0];
  return {
    meta: { data_version: latest?.version ?? null, updated_at: latest?.updated_at ?? null },
    supportedYears: new Set(v.map((r) => r.year)),
    holidays: ((rows?.results ?? []) as unknown as HolidayRow[]).map((r) => ({
      date: r.date,
      name_id: r.name_id,
      name_en: r.name_en,
      type: r.type,
      source: { ref: r.source_ref, url: r.source_url },
    })),
  };
}
