import { Hono, type Context } from "hono";
import { MAX_ADD_DAYS, MAX_RANGE_DAYS } from "./config";
import { loadHolidayData } from "./db";
import { ApiError, badRequest } from "./errors";
import {
  addBusinessDays,
  Calendar,
  countDays,
  formatDate,
  monthRange,
  parseDate,
  yearOf,
  type CalendarOptions,
  type HolidayType,
} from "./lib/businessDays";
import type { AppEnv } from "./types";

type Ctx = Context<AppEnv>;

function requireDate(c: Ctx, name: string): number {
  const raw = c.req.query(name);
  if (!raw) throw badRequest(`Query parameter '${name}' is required (YYYY-MM-DD).`, "missing_parameter");
  const day = parseDate(raw);
  if (day === null) throw badRequest(`'${name}' must be a valid calendar date in YYYY-MM-DD format.`, "invalid_date");
  return day;
}

function parseOptions(c: Ctx): CalendarOptions {
  const cuti = c.req.query("cuti_bersama") ?? "include";
  const week = c.req.query("week") ?? "5";
  if (cuti !== "include" && cuti !== "exclude") throw badRequest("'cuti_bersama' must be 'include' or 'exclude'.");
  if (week !== "5" && week !== "6") throw badRequest("'week' must be 5 or 6.");
  return { cutiBersama: cuti, week: week === "5" ? 5 : 6 };
}

async function calendarFor(c: Ctx, fromYear: number, toYear: number, options: CalendarOptions) {
  const data = await loadHolidayData(c.env.DB, fromYear, toYear);
  return { ...data, cal: new Calendar(data.holidays, options, data.supportedYears) };
}

const echoOptions = (o: CalendarOptions) => ({ cuti_bersama: o.cutiBersama, week: o.week });

export const v1 = new Hono<AppEnv>();

v1.get("/holidays", async (c) => {
  const yearRaw = c.req.query("year");
  if (!yearRaw) throw badRequest("Query parameter 'year' is required.", "missing_parameter");
  if (!/^\d{4}$/.test(yearRaw)) throw badRequest("'year' must be a 4-digit year.");
  const year = Number(yearRaw);
  const type = c.req.query("type") as HolidayType | undefined;
  if (type !== undefined && type !== "national" && type !== "cuti_bersama") {
    throw badRequest("'type' must be 'national' or 'cuti_bersama'.");
  }
  const { meta, supportedYears, holidays } = await loadHolidayData(c.env.DB, year, year);
  if (!supportedYears.has(year)) throw yearNotSupported(year);
  return c.json({ year, holidays: type ? holidays.filter((h) => h.type === type) : holidays, meta });
});

v1.get("/working-day", async (c) => {
  const day = requireDate(c, "date");
  const options = parseOptions(c);
  const y = yearOf(day);
  const { meta, cal } = await calendarFor(c, y, y, options);
  const info = cal.info(day);
  return c.json({
    date: info.date,
    is_working_day: info.working,
    is_weekend: info.weekend,
    reason: info.holidays.length ? info.holidays.map((h) => h.name_en).join(" / ") : info.weekend ? "weekend" : null,
    holiday: info.holidays[0] ?? null,
    holidays: info.holidays,
    options: echoOptions(options),
    meta,
  });
});

v1.get("/business-days/add", async (c) => {
  const day = requireDate(c, "date");
  const daysRaw = c.req.query("days");
  if (daysRaw === undefined) throw badRequest("Query parameter 'days' is required.", "missing_parameter");
  if (!/^-?\d+$/.test(daysRaw)) throw badRequest("'days' must be an integer.");
  const days = Number(daysRaw);
  if (Math.abs(days) > MAX_ADD_DAYS) throw badRequest(`|days| must be <= ${MAX_ADD_DAYS}.`, "out_of_range");
  const options = parseOptions(c);
  // 1000 business days span < 5 calendar years; load a margin either side.
  const y = yearOf(day);
  const { meta, cal } = await calendarFor(c, y - 5, y + 5, options);
  cal.assertSupported(day);
  const result = addBusinessDays(cal, day, days);
  return c.json({ date: formatDate(day), days, result: formatDate(result), options: echoOptions(options), meta });
});

v1.get("/working-days/count", async (c) => {
  const month = c.req.query("month");
  let start: number;
  let end: number;
  if (month !== undefined) {
    if (c.req.query("start") || c.req.query("end")) throw badRequest("Use either 'month' or 'start'+'end', not both.");
    const r = monthRange(month);
    if (!r) throw badRequest("'month' must be a valid month in YYYY-MM format.", "invalid_date");
    [start, end] = r;
  } else {
    start = requireDate(c, "start");
    end = requireDate(c, "end");
    if (end < start) throw badRequest("'end' must be on or after 'start'.", "invalid_range");
    if (end - start + 1 > MAX_RANGE_DAYS) throw badRequest(`Range must be at most ${MAX_RANGE_DAYS} days.`, "out_of_range");
  }
  const options = parseOptions(c);
  const { meta, cal, holidays } = await calendarFor(c, yearOf(start), yearOf(end), options);
  const [s, e] = [formatDate(start), formatDate(end)];
  return c.json({
    start: s,
    end: e,
    ...countDays(cal, start, end),
    holidays: holidays.filter((h) => h.date >= s && h.date <= e && (options.cutiBersama === "include" || h.type !== "cuti_bersama")),
    options: echoOptions(options),
    meta,
  });
});

export const yearNotSupported = (year: number) =>
  new ApiError(422, "year_not_supported", `No holiday data is loaded for year ${year}.`);
