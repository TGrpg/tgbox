/**
 * Telegram Mini App launch data (`initData`) verification.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * Shared by the admin panel and the public Mini App: both receive the raw launch string in an
 * `X-Telegram-Init-Data` header and have to decide, without asking Telegram, who sent it.
 */

/** Telegram signs the launch string once; a day is as long as either app will honour it. */
const INIT_DATA_MAX_AGE_S = 24 * 60 * 60;
/** A client clock running slightly ahead of ours must not invalidate a fresh launch. */
const CLOCK_SKEW_S = 60;

export type InitDataUser = {
  id: number;
  firstName: string | null;
  username: string | null;
  /** Telegram client language, e.g. "zh-hans", "en". */
  languageCode: string | null;
  photoUrl: string | null;
  /**
   * `start_param`, i.e. the `startapp=` value of the link the app was opened with. It travels
   * inside the signed payload, but Telegram only signs that *this user* opened *this link* — the
   * value itself was written by whoever shared the link, which may be anybody. Treat it as
   * untrusted input: use it to pick a screen, never to decide what the user is allowed to see.
   */
  startParam: string | null;
};

const hex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

async function hmac(key: Uint8Array, data: string) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    // Copied into a view of its own: `importKey` refuses one that might be backed by a
    // SharedArrayBuffer, which is what an encoder's output is typed as.
    new Uint8Array(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The `user` field is JSON written by the client: read it defensively, field by field. */
function parseUser(json: string | null): InitDataUser | null {
  if (json === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const user: Record<string, unknown> = { ...value };
  if (typeof user.id !== "number" || !Number.isSafeInteger(user.id)) return null;
  const text = (field: unknown) => (typeof field === "string" && field !== "" ? field : null);
  return {
    id: user.id,
    firstName: text(user.first_name),
    username: text(user.username),
    languageCode: text(user.language_code),
    photoUrl: text(user.photo_url),
    startParam: null,
  };
}

/**
 * Verifies the HMAC, the age and the user of a Mini App launch string.
 * Returns the user, or null when anything about it is wrong.
 */
export async function verifyInitData(
  initData: string,
  botToken: string | undefined,
  nowMs: number,
): Promise<InitDataUser | null> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash || !botToken) return null;
  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("\n");
  const secret = new Uint8Array(await hmac(new TextEncoder().encode("WebAppData"), botToken));
  const expected = hex(await hmac(secret, dataCheckString));
  if (!timingSafeEqual(expected, hash.toLowerCase())) return null;

  const authDate = Number(params.get("auth_date"));
  const ageS = nowMs / 1000 - authDate;
  if (!Number.isFinite(authDate) || ageS > INIT_DATA_MAX_AGE_S || ageS < -CLOCK_SKEW_S) return null;

  const user = parseUser(params.get("user"));
  if (!user) return null;
  return { ...user, startParam: params.get("start_param") };
}
