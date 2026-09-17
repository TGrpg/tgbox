import { type Actor, emailActor, tgActor } from "@tgbox/core";
import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from "jose";
import { z } from "zod";

export type AuthEnv = Pick<
  Env,
  | "ADMIN_EMAILS"
  | "ADMIN_IDS"
  | "CF_ACCESS_TEAM_DOMAIN"
  | "CF_ACCESS_AUD"
  | "ADMIN_DEV_BYPASS"
  | "BOT_TOKEN"
>;

export type AdminAuth = { actor: Actor; via: "access" | "telegram" | "dev" };

const INIT_DATA_MAX_AGE_S = 24 * 60 * 60;

const list = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

// jose caches fetched keys per key set; keep one per team domain for the isolate's lifetime.
const remoteKeySets = new Map<string, JWTVerifyGetKey>();
function accessKeys(teamDomain: string) {
  let keys = remoteKeySets.get(teamDomain);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
    remoteKeySets.set(teamDomain, keys);
  }
  return keys;
}

/** Verifies a Cloudflare Access JWT; returns the lowercased email, or null. */
async function verifyAccessJwt(
  token: string,
  config: { teamDomain: string; aud: string },
  keys: JWTVerifyGetKey = accessKeys(config.teamDomain),
) {
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer: `https://${config.teamDomain}`,
      audience: config.aud,
      algorithms: ["RS256"],
    });
    return typeof payload.email === "string" ? payload.email.toLowerCase() : null;
  } catch {
    return null;
  }
}

const hex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

async function hmac(key: BufferSource, data: string) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
}

const InitDataUser = z.object({ id: z.number().int() });

/**
 * Verifies Telegram Mini App `initData` (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app).
 * Returns the Telegram user id, or null when the signature, age or user is invalid.
 */
async function verifyInitData(initData: string, botToken: string, nowMs: number) {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash || !botToken) return null;
  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("\n");
  const secret = await hmac(new TextEncoder().encode("WebAppData"), botToken);
  const expected = hex(await hmac(secret, dataCheckString));
  if (!timingSafeEqual(expected, hash.toLowerCase())) return null;

  const authDate = Number(params.get("auth_date"));
  const ageS = nowMs / 1000 - authDate;
  if (!Number.isFinite(authDate) || ageS > INIT_DATA_MAX_AGE_S || ageS < -60) return null;

  let user: unknown;
  try {
    user = JSON.parse(params.get("user") ?? "");
  } catch {
    return null;
  }
  const parsed = InitDataUser.safeParse(user);
  return parsed.success ? parsed.data.id : null;
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Resolves the admin behind a request: Cloudflare Access JWT, then Telegram initData, then the
 * localhost-only dev bypass. Returns null when none succeeds.
 */
export async function authenticate(
  request: Request,
  env: AuthEnv,
  options: { now?: number; accessKeys?: JWTVerifyGetKey } = {},
): Promise<AdminAuth | null> {
  const accessToken = request.headers.get("Cf-Access-Jwt-Assertion");
  if (accessToken && env.CF_ACCESS_TEAM_DOMAIN && env.CF_ACCESS_AUD) {
    const email = await verifyAccessJwt(
      accessToken,
      { teamDomain: env.CF_ACCESS_TEAM_DOMAIN, aud: env.CF_ACCESS_AUD },
      options.accessKeys,
    );
    if (email && list(env.ADMIN_EMAILS).includes(email)) {
      return { actor: emailActor(email), via: "access" };
    }
  }

  const initData = request.headers.get("X-Telegram-Init-Data");
  if (initData) {
    const userId = await verifyInitData(initData, env.BOT_TOKEN, options.now ?? Date.now());
    if (userId !== null && list(env.ADMIN_IDS).includes(String(userId))) {
      return { actor: tgActor(userId), via: "telegram" };
    }
  }

  if (env.ADMIN_DEV_BYPASS === "1" && LOCAL_HOSTS.has(new URL(request.url).hostname)) {
    return { actor: emailActor("dev@localhost"), via: "dev" };
  }
  return null;
}
