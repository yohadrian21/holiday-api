import { describe, expect, it } from "vitest";
import {
  addBusinessDays,
  Calendar,
  countDays,
  formatDate,
  monthRange,
  parseDate,
  YearNotSupportedError,
  type CalendarOptions,
  type Holiday,
} from "../src/lib/businessDays";

// Synthetic, clearly-fake holidays (NOT real Indonesian data).
const H: Holiday[] = [
  { date: "2026-03-02", name_id: "Libur Palsu A", name_en: "Fake Holiday A", type: "national" }, // Mon
  { date: "2026-03-03", name_id: "Cuti Palsu", name_en: "Fake Cuti", type: "cuti_bersama" }, // Tue
  { date: "2026-03-07", name_id: "Libur Sabtu", name_en: "Fake Saturday Holiday", type: "national" }, // Sat
  { date: "2027-01-01", name_id: "Tahun Baru Palsu", name_en: "Fake New Year", type: "national" }, // Fri
];

const d = (s: string) => {
  const v = parseDate(s);
  if (v === null) throw new Error(`bad test date ${s}`);
  return v;
};
const cal = (o: Partial<CalendarOptions> = {}, years?: number[]) =>
  new Calendar(H, { cutiBersama: "include", week: 5, ...o }, years ? new Set(years) : undefined);
const add = (start: string, n: number, o: Partial<CalendarOptions> = {}) => formatDate(addBusinessDays(cal(o), d(start), n));
const month = (m: string, o: Partial<CalendarOptions> = {}) => {
  const [s, e] = monthRange(m)!;
  return countDays(cal(o), s, e);
};

describe("date parsing", () => {
  it("round-trips valid dates", () => {
    expect(formatDate(d("2024-02-29"))).toBe("2024-02-29");
    expect(formatDate(d("1970-01-01"))).toBe("1970-01-01");
  });
  it.each(["2026-02-30", "2025-02-29", "2026-13-01", "2026-00-10", "2026-1-01", "20260101", "2026-01-01T00:00", "", "0099-01-01"])(
    "rejects %j",
    (s) => expect(parseDate(s)).toBeNull(),
  );
  it("rejects invalid months", () => {
    expect(monthRange("2026-13")).toBeNull();
    expect(monthRange("2026-2")).toBeNull();
  });
});

describe("working-day info", () => {
  it("weekends are non-working; weekdays working", () => {
    expect(cal().info(d("2026-03-08")).working).toBe(false); // Sun
    expect(cal().info(d("2026-03-14")).weekend).toBe(true); // Sat
    expect(cal().info(d("2026-03-04")).working).toBe(true); // Wed
  });
  it("cuti bersama include vs exclude", () => {
    expect(cal().info(d("2026-03-03")).working).toBe(false);
    expect(cal({ cutiBersama: "exclude" }).info(d("2026-03-03")).working).toBe(true);
    expect(cal({ cutiBersama: "exclude" }).info(d("2026-03-02")).working).toBe(false);
  });
  it("6-day week makes Saturday working unless a holiday", () => {
    expect(cal({ week: 6 }).info(d("2026-03-14")).working).toBe(true);
    expect(cal({ week: 6 }).info(d("2026-03-07")).working).toBe(false);
    expect(cal({ week: 6 }).info(d("2026-03-08")).working).toBe(false);
  });
});

describe("addBusinessDays", () => {
  it("skips weekends", () => expect(add("2026-03-13", 1)).toBe("2026-03-16"));
  it("crosses holidays and cuti bersama", () => {
    expect(add("2026-02-27", 1)).toBe("2026-03-04");
    expect(add("2026-03-01", 10)).toBe("2026-03-17");
  });
  it("cuti bersama exclude treats cuti as working", () => expect(add("2026-02-27", 1, { cutiBersama: "exclude" })).toBe("2026-03-03"));
  it("6-day week", () => {
    expect(add("2026-03-13", 1, { week: 6 })).toBe("2026-03-14");
    expect(add("2026-03-06", 1, { week: 6 })).toBe("2026-03-09"); // Sat 03-07 is a holiday
  });
  it("negative N", () => {
    expect(add("2026-03-04", -1)).toBe("2026-02-27");
    expect(add("2026-03-16", -1)).toBe("2026-03-13");
    expect(add("2026-03-17", -10)).toBe("2026-02-27");
  });
  it("N=0 returns the date if working, else the next working day", () => {
    expect(add("2026-03-04", 0)).toBe("2026-03-04");
    expect(add("2026-03-02", 0)).toBe("2026-03-04");
    expect(add("2026-03-07", 0)).toBe("2026-03-09");
  });
  it("year boundary Dec 31 -> Jan", () => {
    expect(add("2026-12-31", 1)).toBe("2027-01-04");
    expect(add("2027-01-04", -1)).toBe("2026-12-31");
  });
  it("throws when stepping into an unsupported year", () => {
    expect(() => addBusinessDays(cal({}, [2026]), d("2026-12-31"), 1)).toThrow(YearNotSupportedError);
    expect(formatDate(addBusinessDays(cal({}, [2026, 2027]), d("2026-12-31"), 1))).toBe("2027-01-04");
  });
});

describe("countDays", () => {
  it("month with holidays; weekend holiday not double counted", () => {
    expect(month("2026-03")).toEqual({
      calendar_days: 31,
      working_days: 20,
      weekend_days: 9,
      holidays_on_weekdays: 2,
      holidays_on_weekends: 1,
      non_working_days: 11,
    });
  });
  it("cuti bersama exclude", () => expect(month("2026-03", { cutiBersama: "exclude" }).working_days).toBe(21));
  it("6-day week", () => {
    expect(month("2026-03", { week: 6 })).toMatchObject({ weekend_days: 5, holidays_on_weekdays: 3, holidays_on_weekends: 0, working_days: 23 });
  });
  it("February leap and non-leap years", () => {
    expect(month("2024-02")).toMatchObject({ calendar_days: 29, weekend_days: 8, working_days: 21 });
    expect(month("2026-02")).toMatchObject({ calendar_days: 28, weekend_days: 8, working_days: 20 });
  });
  it("inclusive range across a year boundary", () => {
    expect(countDays(cal(), d("2026-12-31"), d("2027-01-04"))).toMatchObject({ calendar_days: 5, working_days: 2, weekend_days: 2, holidays_on_weekdays: 1 });
  });
  it("single day", () => expect(countDays(cal(), d("2026-03-04"), d("2026-03-04")).working_days).toBe(1));
});
