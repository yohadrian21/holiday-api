import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { createKey, getJson } from "./helpers";

// Exercises the operator-supplied data/holidays/*.json (validated + seeded in setup). Skipped when none exist.
describe.skipIf(env.TEST_SEED.length === 0)("real seed data", () => {
  it.each(env.TEST_SEED.map((y) => [y.version.year, y] as const))("%i is served as seeded", async (year, seed) => {
    const { key } = await createKey("business");
    const { status, body } = await getJson(`/v1/holidays?year=${year}`, key);
    expect(status).toBe(200);
    expect(body.holidays).toHaveLength(seed.holidays.length);
  });
});

// Ground-truth assertions against the real SKB data for 2024-2027 (independently computed).
const loadedYears = new Set(env.TEST_SEED.map((y) => y.version.year));
describe.skipIf(![2024, 2025, 2026, 2027].every((y) => loadedYears.has(y)))("real data 2024-2027", () => {
  let key: string;
  beforeAll(async () => {
    key = (await createKey("business")).key;
  });

  /** GET with the shared key; asserts meta is present on every response. */
  async function call(path: string, expectedStatus = 200) {
    const r = await getJson(path, key);
    expect(r.status, `${path} -> ${JSON.stringify(r.body)}`).toBe(expectedStatus);
    if (expectedStatus === 200) {
      expect(r.body.meta.data_version).toEqual(expect.any(String));
      expect(r.body.meta.updated_at).toEqual(expect.any(String));
    }
    return r.body;
  }

  describe("holiday counts per year", () => {
    it.each([
      [2024, 17, 10],
      [2025, 17, 11],
      [2026, 17, 8],
      [2027, 18, 8],
    ])("%i: %i national / %i cuti bersama", async (year, national, cuti) => {
      const all = await call(`/v1/holidays?year=${year}`);
      expect(all.holidays).toHaveLength(national + cuti);
      expect(all.holidays.filter((h: any) => h.type === "national")).toHaveLength(national);
      expect(all.holidays.filter((h: any) => h.type === "cuti_bersama")).toHaveLength(cuti);
      expect((await call(`/v1/holidays?year=${year}&type=national`)).holidays).toHaveLength(national);
      expect((await call(`/v1/holidays?year=${year}&type=cuti_bersama`)).holidays).toHaveLength(cuti);
    });
  });

  describe("working-day", () => {
    it("2026-03-20 is Idul Fitri cuti bersama (non-working), working when cuti excluded", async () => {
      const b = await call("/v1/working-day?date=2026-03-20");
      expect(b.is_working_day).toBe(false);
      // `reason` is the English name per openapi.yaml; the Indonesian name is in holiday.name_id.
      expect(b.reason).toContain("Eid al-Fitr");
      expect(b.holiday).toMatchObject({ type: "cuti_bersama" });
      expect(b.holiday.name_id).toContain("Idul Fitri");
      expect((await call("/v1/working-day?date=2026-03-20&cuti_bersama=exclude")).is_working_day).toBe(true);
    });

    it("2025-08-18 is cuti bersama HUT ke-80 RI", async () => {
      const b = await call("/v1/working-day?date=2025-08-18");
      expect(b.is_working_day).toBe(false);
      expect(b.holiday).toMatchObject({ type: "cuti_bersama" });
      expect(b.holiday.name_id).toContain("HUT ke-80 RI");
    });

    it("2026-03-21 (Saturday, Idul Fitri) is non-working", async () => {
      const b = await call("/v1/working-day?date=2026-03-21");
      expect(b).toMatchObject({ is_working_day: false, is_weekend: true });
      expect(b.holiday.name_id).toContain("Idul Fitri");
    });

    it("2026-11-03 is a working day", async () => {
      expect(await call("/v1/working-day?date=2026-11-03")).toMatchObject({ is_working_day: true, reason: null });
    });
  });

  describe("working-days/count", () => {
    it.each([
      ["", 17],
      ["&cuti_bersama=exclude", 21],
      ["&week=6", 20],
    ])("month=2026-03%s -> %i", async (opts, expected) => {
      expect((await call(`/v1/working-days/count?month=2026-03${opts}`)).working_days).toBe(expected);
    });

    it.each([
      [2024, 240, 250],
      [2025, 237, 248],
      [2026, 240, 248],
      [2027, 242, 250],
    ])("full year %i: %i (include) / %i (exclude)", async (year, include, exclude) => {
      const range = `start=${year}-01-01&end=${year}-12-31`;
      expect((await call(`/v1/working-days/count?${range}`)).working_days).toBe(include);
      expect((await call(`/v1/working-days/count?${range}&cuti_bersama=exclude`)).working_days).toBe(exclude);
    });
  });

  describe("business-days/add", () => {
    it.each([
      ["2024-04-05", 3, "", "2024-04-18"],
      ["2024-04-05", 3, "&cuti_bersama=exclude", "2024-04-12"],
      ["2026-03-25", -1, "", "2026-03-17"],
      ["2026-03-25", -1, "&cuti_bersama=exclude", "2026-03-24"],
      ["2025-12-24", 3, "", "2025-12-31"],
      ["2026-12-23", 2, "", "2026-12-29"],
    ])("%s days=%s%s -> %s", async (date, days, opts, expected) => {
      expect((await call(`/v1/business-days/add?date=${date}&days=${days}${opts}`)).result).toBe(expected);
    });

    it("2027-12-30 +5 runs into 2028 (not loaded) -> 422", async () => {
      const b = await call("/v1/business-days/add?date=2027-12-30&days=5", 422);
      expect(b.error).toMatchObject({ code: "year_not_supported" });
      expect(b.error.message).toContain("2028");
    });

    it.each([1, -1, 0, 5])("2023-12-29 days=%s -> 422 (2023 not loaded)", async (days) => {
      const b = await call(`/v1/business-days/add?date=2023-12-29&days=${days}`, 422);
      expect(b.error).toMatchObject({ code: "year_not_supported" });
    });
  });
});
