import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

export const badRequest = (message: string, code = "invalid_parameter") => new ApiError(400, code, message);

export function errorResponse(c: Context, err: ApiError): Response {
  for (const [k, v] of Object.entries(err.headers)) c.header(k, v);
  return c.json({ error: { code: err.code, message: err.message } }, err.status);
}
