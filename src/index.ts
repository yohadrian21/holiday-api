import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth } from "./auth";
import { loadHolidayData } from "./db";
import { ApiError, errorResponse } from "./errors";
import { YearNotSupportedError } from "./lib/businessDays";
import { v1, yearNotSupported } from "./routes";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>();

app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "OPTIONS"],
    allowHeaders: ["X-API-Key", "Content-Type"],
    exposeHeaders: ["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset", "Retry-After"],
    maxAge: 86400,
  }),
);

app.get("/v1/health", async (c) => {
  const { meta } = await loadHolidayData(c.env.DB, 0, -1);
  return c.json({ status: "ok", time: new Date().toISOString(), meta });
});

app.use("/v1/*", auth);
app.route("/v1", v1);

app.notFound((c) => c.json({ error: { code: "not_found", message: "Route not found." } }, 404));

app.onError((err, c) => {
  if (err instanceof ApiError) return errorResponse(c, err);
  if (err instanceof YearNotSupportedError) return errorResponse(c, yearNotSupported(err.year));
  console.error(err);
  return c.json({ error: { code: "internal_error", message: "Internal server error." } }, 500);
});

export default app;
