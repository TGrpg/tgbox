import { createHmac } from "node:crypto";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, test } from "vitest";
import { type AuthEnv, authenticate } from "./auth.ts";

const NOW = Date.UTC(2026, 8, 17);
const TEAM = "tgbox.cloudflareaccess.com";
const AUD = "aud-tag";
const BOT_TOKEN = "123456:secret";

const env: AuthEnv = {
  ADMIN_EMAILS: "Admin@Example.com, other@example.com",
  ADMIN_IDS: "900, 901",
  CF_ACCESS_TEAM_DOMAIN: TEAM,
  CF_ACCESS_AUD: AUD,
  ADMIN_DEV_BYPASS: "",
  BOT_TOKEN,
};

type Keys = Awaited<ReturnType<typeof generateKeyPair>>;
let accessKeys: ReturnType<typeof createLocalJWKSet>;
let trusted: Keys;
let untrusted: Keys;

beforeAll(async () => {
  trusted = await generateKeyPair("RS256");
  untrusted = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(trusted.publicKey)), kid: "k1", alg: "RS256" };
  accessKeys = createLocalJWKSet({ keys: [jwk] });
});

type AccessClaims = { email: string; aud?: string; iss?: string; expSeconds?: number };

function signAccess(claims: AccessClaims) {
  const key = claims.email === "forged@example.com" ? untrusted : trusted;
  return new SignJWT({ email: claims.email })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(claims.iss ?? `https://${TEAM}`)
    .setAudience(claims.aud ?? AUD)
    .setIssuedAt()
    .setExpirationTime(`${claims.expSeconds ?? 600}s`)
    .sign(key.privateKey);
}

/** Builds initData signed the way Telegram does. */
function initData(fields: { user: unknown; authDate: number }, token = BOT_TOKEN) {
  const params = new URLSearchParams({
    query_id: "AAE",
    user: JSON.stringify(fields.user),
    auth_date: String(fields.authDate),
  });
  const checkString = [...params.entries()]
    .map((pair) => pair.join("="))
    .sort()
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  params.set("hash", createHmac("sha256", secret).update(checkString).digest("hex"));
  return params.toString();
}

const request = (headers: Record<string, string>, url = "https://admin.tgbox.test/_serverFn/x") =>
  new Request(url, { headers });

describe("Cloudflare Access", () => {
  test("a valid JWT for an allowed email authenticates as that email", async () => {
    const token = await signAccess({ email: "ADMIN@example.com" });
    expect(
      await authenticate(request({ "Cf-Access-Jwt-Assertion": token }), env, { accessKeys }),
    ).toEqual({ actor: "email:admin@example.com", via: "access" });
  });

  test.each([
    ["an email not in ADMIN_EMAILS", { email: "stranger@example.com" }],
    ["another audience", { email: "admin@example.com", aud: "other-app" }],
    ["another issuer", { email: "admin@example.com", iss: "https://evil.cloudflareaccess.com" }],
    ["an expired token", { email: "admin@example.com", expSeconds: -60 }],
    ["a token signed with an unknown key", { email: "forged@example.com" }],
  ])("rejects %s", async (_name, claims) => {
    const token = await signAccess(claims);
    const envWithForged = { ...env, ADMIN_EMAILS: `${env.ADMIN_EMAILS},forged@example.com` };
    expect(
      await authenticate(request({ "Cf-Access-Jwt-Assertion": token }), envWithForged, {
        accessKeys,
      }),
    ).toBeNull();
  });
});

describe("Telegram Mini App initData", () => {
  const nowS = NOW / 1000;

  test("valid initData from an admin authenticates as the Telegram user", async () => {
    const data = initData({ user: { id: 900, first_name: "Alice" }, authDate: nowS - 60 });
    expect(
      await authenticate(request({ "X-Telegram-Init-Data": data }), env, { now: NOW }),
    ).toEqual({
      actor: "tg:900",
      via: "telegram",
    });
  });

  test.each([
    ["a non-admin user", initData({ user: { id: 1 }, authDate: nowS })],
    ["initData older than 24 hours", initData({ user: { id: 900 }, authDate: nowS - 25 * 3600 })],
    ["a signature from another bot", initData({ user: { id: 900 }, authDate: nowS }, "999:other")],
    [
      "tampered fields",
      initData({ user: { id: 1 }, authDate: nowS }).replace("%22id%22%3A1", "%22id%22%3A900"),
    ],
    ["no hash", "user=%7B%22id%22%3A900%7D&auth_date=1"],
  ])("rejects %s", async (_name, data) => {
    expect(
      await authenticate(request({ "X-Telegram-Init-Data": data }), env, { now: NOW }),
    ).toBeNull();
  });
});

describe("dev bypass", () => {
  const devEnv = { ...env, ADMIN_DEV_BYPASS: "1" };

  test("applies only to localhost requests", async () => {
    expect(await authenticate(request({}, "http://127.0.0.1:8789/"), devEnv)).toEqual({
      actor: "email:dev@localhost",
      via: "dev",
    });
    expect(await authenticate(request({}, "http://localhost:8789/"), devEnv)).not.toBeNull();
    expect(await authenticate(request({}), devEnv)).toBeNull();
  });

  test("is off unless ADMIN_DEV_BYPASS is 1", async () => {
    expect(await authenticate(request({}, "http://127.0.0.1:8789/"), env)).toBeNull();
  });
});
