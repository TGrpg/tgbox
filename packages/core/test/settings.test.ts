import { env } from "cloudflare:workers";
import {
  getCredential,
  getSettings,
  hasCredential,
  SettingsKeyMissingError,
  setCredential,
  updateSettings,
} from "@tgbox/core";
import { getSiteState, upsertSetting } from "@tgbox/db";
import { settingsDefaults } from "@tgbox/shared";
import { describe, expect, test } from "vitest";
import { actor, auditRows, db, NOW, setup } from "./fake.ts";

describe("settings", () => {
  test("missing, malformed and invalid rows fall back to defaults per key", async () => {
    const { ctx } = await setup();
    expect(await getSettings(ctx)).toEqual(settingsDefaults);

    await upsertSetting(db, "bot", "{not json", NOW);
    await upsertSetting(db, "payments", JSON.stringify({ cryptoPayNetwork: "moon" }), NOW);
    // A stored row missing newer fields keeps what it has and takes defaults for the rest.
    await upsertSetting(db, "site", JSON.stringify({}), NOW);
    expect(await getSettings(ctx)).toEqual(settingsDefaults);

    await upsertSetting(db, "payments", JSON.stringify({ cryptoPayEnabled: true }), NOW);
    expect((await getSettings(ctx)).payments).toEqual({
      ...settingsDefaults.payments,
      cryptoPayEnabled: true,
    });
  });

  test("updates validate, audit only real changes, and the site key triggers a rebuild", async () => {
    const { ctx, dispatches } = await setup();
    const bot = { ...settingsDefaults.bot, submitDailyLimit: 10, reviewChatId: "-100123" };

    expect(
      await updateSettings(ctx, {
        key: "bot",
        value: { ...bot, submitDailyLimit: 0 },
        actor,
      }),
    ).toEqual({ ok: false, error: "invalid" });
    expect(await updateSettings(ctx, { key: "bot", value: bot, actor })).toEqual({
      ok: true,
      changed: true,
    });
    expect(await updateSettings(ctx, { key: "bot", value: bot, actor })).toEqual({
      ok: true,
      changed: false,
    });
    expect((await getSettings(ctx)).bot).toEqual(bot);
    expect(dispatches).toEqual([]);

    const site = {
      ...settingsDefaults.site,
      announcement: { enabled: true, zh: "公告", en: "News", href: null },
    };
    await updateSettings(ctx, { key: "site", value: site, actor });
    expect(await getSiteState(db, "dirty_since")).toBe(String(NOW));
    expect(dispatches).toHaveLength(1);
    expect(await auditRows()).toEqual([
      { actor: "email:admin@example.com", action: "settings.update", target: "settings:bot" },
      { actor: "email:admin@example.com", action: "settings.update", target: "settings:site" },
    ]);
  });
});

describe("credentials", () => {
  test("round-trips encrypted, never stores the plain value, and needs the same key", async () => {
    const { ctx } = await setup({ SETTINGS_KEY: "secret-one" });
    expect(await hasCredential(ctx, "cryptopay_token")).toBe(false);
    expect(await getCredential(ctx, "cryptopay_token")).toBeNull();

    await setCredential(ctx, { key: "cryptopay_token", value: "12345:AAAtoken", actor });
    expect(await hasCredential(ctx, "cryptopay_token")).toBe(true);
    expect(await getCredential(ctx, "cryptopay_token")).toBe("12345:AAAtoken");

    const row = await env.DB.prepare("SELECT ciphertext FROM credentials").first<{
      ciphertext: string;
    }>();
    expect(row?.ciphertext).toMatch(/^[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/);
    expect(row?.ciphertext).not.toContain("AAAtoken");
    const audit = await env.DB.prepare("SELECT payload FROM audit_log").first();
    expect(JSON.stringify(audit)).not.toContain("AAAtoken");

    const rotated = { ...ctx, config: { ...ctx.config, SETTINGS_KEY: "secret-two" } };
    expect(await getCredential(rotated, "cryptopay_token")).toBeNull();
  });

  test("an empty SETTINGS_KEY is a typed error", async () => {
    const { ctx } = await setup({ SETTINGS_KEY: "" });
    await expect(
      setCredential(ctx, { key: "cryptopay_token", value: "x", actor }),
    ).rejects.toBeInstanceOf(SettingsKeyMissingError);
  });
});
