/**
 * Pure calendar-date arithmetic. A day is represented as an integer "epoch day"
 * (days since 1970-01-01, UTC calendar). No timezones are involved: inputs are
 * Asia/Jakarta calendar dates and are treated as plain dates.
 */

export type HolidayType = "national" | "cuti_bersama";

export interface Holiday {
  date: string;
  name_id: string;
  name_en: string;
  type: HolidayType;
  source?: { ref: string; url: string };
}

export interface CalendarOptions {
  /** include (default): cuti bersama is a non-working day. exclude: treated as a working day. */
  cutiBersama: "include" | "exclude";
  /** 5 (default): Sat+Sun off. 6: only Sunday off. */
  week: 5 | 6;
}

export const DEFAULT_OPTIONS: CalendarOptions = { cutiBersama: "include", week: 5 };

const MS_PER_DAY = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export class YearNotSupportedError extends Error {
  constructor(readonly year: number) {
    super(`No holiday data loaded for year ${year}`);
  }
}

/** Parses strict YYYY-MM-DD into an epoch day; returns null for malformed or impossible dates (e.g. 2026-02-30). */
export function parseDate(s: string): number | null {
  const m = DATE_RE.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const dt = new Date(t);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return t / MS_PER_DAY;
}

export function formatDate(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

export function yearOf(day: number): number {
  return new Date(day * MS_PER_DAY).getUTCFullYear();
}

/** 0 = Sunday … 6 = Saturday. 1970-01-01 was a Thursday. */
export function weekday(day: number): number {
  return (((day + 4) % 7) + 7) % 7;
}

export function isWeekend(day: number, week: 5 | 6): boolean {
  const wd = weekday(day);
  return wd === 0 || (week === 5 && wd === 6);
}

/** Parses 'YYYY-MM' into the inclusive [first, last] epoch days of that month. */
export function monthRange(s: string): [number, number] | null {
  const m = /^(\d{4})-(\d{2})$/.exec(s);
  if (!m) return null;
  const first = parseDate(`${s}-01`);
  if (first === null) return null;
  const last = Date.UTC(Number(m[1]), Number(m[2]), 0) / MS_PER_DAY;
  return [first, last];
}

export interface DayInfo {
  date: string;
  weekend: boolean;
  /** Holidays that make this day non-working under the calendar options. */
  holidays: Holiday[];
  working: boolean;
}

export class Calendar {
  private readonly byDate = new Map<string, Holiday[]>();

  /**
   * @param supportedYears if given, touching a day outside these years throws YearNotSupportedError.
   */
  constructor(
    holidays: Iterable<Holiday>,
    readonly options: CalendarOptions = DEFAULT_OPTIONS,
    private readonly supportedYears?: ReadonlySet<number>,
  ) {
    for (const h of holidays) {
      if (options.cutiBersama === "exclude" && h.type === "cuti_bersama") continue;
      const list = this.byDate.get(h.date);
      if (list) list.push(h);
      else this.byDate.set(h.date, [h]);
    }
  }

  assertSupported(day: number): void {
    const y = yearOf(day);
    if (this.supportedYears && !this.supportedYears.has(y)) throw new YearNotSupportedError(y);
  }

  info(day: number): DayInfo {
    this.assertSupported(day);
    const date = formatDate(day);
    const weekend = isWeekend(day, this.options.week);
    const holidays = this.byDate.get(date) ?? [];
    return { date, weekend, holidays, working: !weekend && holidays.length === 0 };
  }
}

/**
 * Adds n business days to start. n > 0 moves forward, n < 0 backward; the start day itself is never counted.
 * n = 0 returns start if it is a working day, otherwise the next working day after it.
 */
export function addBusinessDays(cal: Calendar, start: number, n: number): number {
  const step = n < 0 ? -1 : 1;
  let remaining = Math.abs(n);
  let day = start;
  if (remaining === 0) {
    while (!cal.info(day).working) day += 1;
    return day;
  }
  while (remaining > 0) {
    day += step;
    if (cal.info(day).working) remaining -= 1;
  }
  return day;
}

export interface DayCounts {
  calendar_days: number;
  working_days: number;
  weekend_days: number;
  /** Non-working holiday dates that fall on an otherwise-working weekday. */
  holidays_on_weekdays: number;
  /** Holiday dates that fall on a weekend (not double-counted as non-working). */
  holidays_on_weekends: number;
  non_working_days: number;
}

/** Counts over the inclusive range [start, end]. Each date is counted once even if it has several holidays. */
export function countDays(cal: Calendar, start: number, end: number): DayCounts {
  const c: DayCounts = {
    calendar_days: 0,
    working_days: 0,
    weekend_days: 0,
    holidays_on_weekdays: 0,
    holidays_on_weekends: 0,
    non_working_days: 0,
  };
  for (let day = start; day <= end; day++) {
    const i = cal.info(day);
    c.calendar_days++;
    if (i.weekend) c.weekend_days++;
    if (i.holidays.length > 0) i.weekend ? c.holidays_on_weekends++ : c.holidays_on_weekdays++;
    if (i.working) c.working_days++;
  }
  c.non_working_days = c.calendar_days - c.working_days;
  return c;
}
