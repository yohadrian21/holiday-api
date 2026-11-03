import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { createKey, get, getJson, seedFakeYears } from "./helpers";

let key: string;
beforeAll(async () => {
  await seedFakeYears();
  key = (await createKey("business")).key;
});
const call = (path: string) => getJson(path, key);

describe("health", () => {
  it("needs no auth", async () => {
    const res = await get("/v1/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok", meta: { data_version: expect.any(String) } });
  });
});

describe("GET /v1/holidays", () => {
  it("lists holidays with source and meta", async () => {
    const { status, body } = await call("/v1/holidays?year=2099");
    expect(status).toBe(200);
    expect(body.holidays).toHaveLength(3);
    expect(body.holidays[0]).toEqual({
      date: "2099-01-01",
      name_id: "Uji New Year",
      name_en: "Test New Year",
      type: "national",
      source: { ref: "TEST-DECREE", url: "https://example.invalid/test-decree" },
    });
    expect(body.meta).toEqual({ data_version: expect.any(String), updated_at: expect.any(String) });
  });
  it("filters by type", async () => {
    const { body } = await call("/v1/holidays?year=2099&type=cuti_bersama");
    expect(body.holidays.map((h: any) => h.date)).toEqual(["2099-01-02"]);
    expect((await call("/v1/holidays?year=2099&type=national")).body.holidays).toHaveLength(2);
  });
  it("supported year with no holidays returns empty list", async () => {
    expect((await call("/v1/holidays?year=2098")).body.holidays).toEqual([]);
  });
});

describe("GET /v1/working-day", () => {
  it("holiday", async () => {
    const { body } = await call("/v1/working-day?date=2099-01-01");
    expect(body).toMatchObject({ date: "2099-01-01", is_working_day: false, reason: "Test New Year", holiday: { type: "national" } });
  });
  it("weekend", async () => {
    expect((await call("/v1/working-day?date=2099-01-04")).body).toMatchObject({ is_working_day: false, reason: "weekend", holiday: null });
  });
  it("working day", async () => {
    expect((await call("/v1/working-day?date=2099-01-05")).body).toMatchObject({ is_working_day: true, reason: null, holiday: null });
  });
  it("cuti bersama include/exclude", async () => {
    expect((await call("/v1/working-day?date=2099-01-02")).body.is_working_day).toBe(false);
    expect((await call("/v1/working-day?date=2099-01-02&cuti_bersama=exclude")).body).toMatchObject({ is_working_day: true, reason: null });
  });
  it("6-day week", async () => {
    expect((await call("/v1/working-day?date=2099-01-10&week=6")).body.is_working_day).toBe(true);
    expect((await call("/v1/working-day?date=2099-01-10")).body.is_working_day).toBe(false);
  });
});

describe("GET /v1/business-days/add", () => {
  it("adds across year boundary and holidays", async () => {
    expect((await call("/v1/business-days/add?date=2098-12-31&days=1")).body).toMatchObject({ date: "2098-12-31", days: 1, result: "2099-01-05" });
    expect((await call("/v1/business-days/add?date=2098-12-31&days=1&cuti_bersama=exclude")).body.result).toBe("2099-01-02");
  });
  it("negative and zero", async () => {
    expect((await call("/v1/business-days/add?date=2099-01-05&days=-1")).body.result).toBe("2098-12-31");
    expect((await call("/v1/business-days/add?date=2099-01-01&days=0")).body.result).toBe("2099-01-05");
  });
  it("422 when stepping into an unsupported year", async () => {
    const { status, body } = await call("/v1/business-days/add?date=2099-12-31&days=1");
    expect(status).toBe(422);
    expect(body.error.code).toBe("year_not_supported");
  });
});

describe("GET /v1/working-days/count", () => {
  it("month", async () => {
    const { body } = await call("/v1/working-days/count?month=2099-01");
    expect(body).toMatchObject({
      start: "2099-01-01",
      end: "2099-01-31",
      calendar_days: 31,
      working_days: 20,
      weekend_days: 9,
      holidays_on_weekdays: 2,
      holidays_on_weekends: 1,
    });
    expect(body.holidays).toHaveLength(3);
    expect(body.meta.data_version).toEqual(expect.any(String));
  });
  it("range with options", async () => {
    const { body } = await call("/v1/working-days/count?start=2098-12-31&end=2099-01-05&cuti_bersama=exclude&week=6");
    // Wed(w) Thu(hol) Fri(cuti->w) Sat(hol) Sun Mon(w)
    expect(body).toMatchObject({ calendar_days: 6, working_days: 3, weekend_days: 1, holidays_on_weekdays: 2 });
  });
});

describe("validation", () => {
  it.each([
    ["/v1/holidays", "missing_parameter"],
    ["/v1/holidays?year=99", "invalid_parameter"],
    ["/v1/holidays?year=2099&type=regional", "invalid_parameter"],
    ["/v1/working-day", "missing_parameter"],
    ["/v1/working-day?date=2099-02-30", "invalid_date"],
    ["/v1/working-day?date=2099-01-05&week=7", "invalid_parameter"],
    ["/v1/working-day?date=2099-01-05&cuti_bersama=yes", "invalid_parameter"],
    ["/v1/business-days/add?date=2099-01-05", "missing_parameter"],
    ["/v1/business-days/add?date=2099-01-05&days=1.5", "invalid_parameter"],
    ["/v1/business-days/add?date=2099-01-05&days=1001", "out_of_range"],
    ["/v1/working-days/count?start=2099-01-05&end=2099-01-01", "invalid_range"],
    ["/v1/working-days/count?start=2089-01-01&end=2099-12-31", "out_of_range"],
    ["/v1/working-days/count?month=2099-13", "invalid_date"],
    ["/v1/working-days/count?start=2099-01-01", "missing_parameter"],
  ])("%s -> 400 %s", async (path, code) => {
    const { status, body } = await call(path);
    expect(status).toBe(400);
    expect(body.error).toEqual({ code, message: expect.any(String) });
  });
  it.each(["/v1/holidays?year=2200", "/v1/working-day?date=2150-01-01", "/v1/working-days/count?month=2150-12", "/v1/business-days/add?date=2150-01-01&days=1"])(
    "%s -> 422 year_not_supported",
    async (path) => {
      const { status, body } = await call(path);
      expect(status).toBe(422);
      expect(body.error.code).toBe("year_not_supported");
    },
  );
  it("unknown route -> 404 JSON", async () => {
    expect((await call("/v1/nope")).status).toBe(404);
  });
});

describe("CORS", () => {
  it("answers preflight without auth", async () => {
    const res = await SELF.fetch("https://api.test/v1/holidays?year=2099", {
      method: "OPTIONS",
      headers: { Origin: "https://example.com", "Access-Control-Request-Method": "GET" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
