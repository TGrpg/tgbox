import { telegramInitData } from "./telegram.ts";

/**
 * Client for `/api/app/*` — the only part of the Mini App that costs a Worker request. Every call
 * carries the raw launch string; the user id always comes from that, never from a request body.
 */

export type ApiError = "unauthorized" | "banned" | "offline" | "bad_response";

export type ApiResult<TData> = { ok: true; data: TData } | { ok: false; error: ApiError };

/** Structural shape of a zod schema, so the client bundle doesn't pull zod in. */
type Parser<TData> = {
  safeParse: (value: unknown) => { success: true; data: TData } | { success: false };
};

type CallOptions = {
  method?: "GET" | "POST";
  /** JSON request body. */
  json?: unknown;
  /** Multipart body (the banner image upload); sent without a Content-Type of our own. */
  form?: FormData;
  signal?: AbortSignal;
};

export async function apiCall<TData>(
  path: string,
  schema: Parser<TData>,
  options: CallOptions = {},
): Promise<ApiResult<TData>> {
  const initData = telegramInitData();
  if (initData === null) return { ok: false, error: "unauthorized" };
  const headers: Record<string, string> = { "X-Telegram-Init-Data": initData };
  if (options.json !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(`/api/app${path}`, {
      method: options.method ?? (options.json === undefined && !options.form ? "GET" : "POST"),
      headers,
      body: options.form ?? (options.json === undefined ? undefined : JSON.stringify(options.json)),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch {
    return { ok: false, error: "offline" };
  }

  if (response.status === 401) return { ok: false, error: "unauthorized" };
  if (response.status === 403) return { ok: false, error: "banned" };

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: "bad_response" };
  }
  const parsed = schema.safeParse(body);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, error: "bad_response" };
}
