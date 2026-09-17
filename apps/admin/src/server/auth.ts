import { type Actor, emailActor, tgActor } from "@tgbox/core";
import { verifyInitData } from "@tgbox/telegram";
import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from "jose";

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

// Unset secrets arrive as undefined in production.
const list = (value = "") =>
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
    const user = await verifyInitData(initData, env.BOT_TOKEN, options.now ?? Date.now());
    if (user && list(env.ADMIN_IDS).includes(String(user.id))) {
      return { actor: tgActor(user.id), via: "telegram" };
    }
  }

  if (env.ADMIN_DEV_BYPASS === "1" && LOCAL_HOSTS.has(new URL(request.url).hostname)) {
    return { actor: emailActor("dev@localhost"), via: "dev" };
  }
  return null;
}
