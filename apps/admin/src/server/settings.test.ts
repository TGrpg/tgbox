import type { CoreContext } from "@tgbox/core";
import { settingsDefaults } from "@tgbox/shared";
import { beforeEach, describe, expect, test, vi } from "vitest";

const core = vi.hoisted(() => ({
  getSettings: vi.fn(),
  hasCredential: vi.fn(),
  setCredential: vi.fn(),
}));
const db = vi.hoisted(() => ({ listBotChats: vi.fn() }));
vi.mock("@tgbox/core", () => core);
vi.mock("@tgbox/db", () => db);

const { loadSettingsView, SettingsInput, saveCryptoPayToken } = await import("./settings.ts");

const ctx = (config: Partial<CoreContext["config"]> = {}) =>
  ({ config: { GITHUB_REPO: "", GITHUB_DISPATCH_TOKEN: "", ...config } }) as CoreContext;

const env = {
  ADMIN_IDS: " 900, 901 ,",
  BOT_TOKEN: "123456:bot-secret",
  GITHUB_DISPATCH_TOKEN: "ghp_dispatch-secret",
  SETTINGS_KEY: "settings-key-secret",
  BOT_PUBLIC_URL: "https://bot.example.workers.dev/",
};

beforeEach(() => vi.clearAllMocks());

describe("SettingsInput", () => {
  const bot = settingsDefaults.bot;
  const site = settingsDefaults.site;

  test.each([
    ["default bot settings", { key: "bot", value: bot }, true],
    [
      "a review chat, admins and support",
      {
        key: "bot",
        value: {
          ...bot,
          reviewChatId: "-1001234567890",
          extraAdminIds: ["42"],
          supportUsername: "tgbox_support",
        },
      },
      true,
    ],
    ["a non-numeric chat id", { key: "bot", value: { ...bot, reviewChatId: "@group" } }, false],
    ["an admin id with letters", { key: "bot", value: { ...bot, extraAdminIds: ["12a"] } }, false],
    [
      "a support username with @",
      { key: "bot", value: { ...bot, supportUsername: "@x_y_z" } },
      false,
    ],
    ["a daily limit of 0", { key: "bot", value: { ...bot, submitDailyLimit: 0 } }, false],
    [
      "a support group with the relay on",
      { key: "bot", value: { ...bot, supportGroupId: "-1001234567890", supportEnabled: true } },
      true,
    ],
    [
      "a support group given as a username",
      { key: "bot", value: { ...bot, supportGroupId: "@support" } },
      false,
    ],
    [
      "no support group with the relay off",
      { key: "bot", value: { ...bot, supportGroupId: null, supportEnabled: false } },
      true,
    ],
    [
      "an announcement with an https link",
      {
        key: "site",
        value: {
          ...site,
          announcement: { enabled: true, zh: "公告", en: "News", href: "https://t.me/x" },
        },
      },
      true,
    ],
    [
      "an announcement with an http link",
      {
        key: "site",
        value: {
          ...site,
          announcement: { enabled: true, zh: "公告", en: "News", href: "http://x.com" },
        },
      },
      false,
    ],
    [
      "an enabled announcement without text",
      { key: "site", value: { ...site, announcement: { ...site.announcement, enabled: true } } },
      false,
    ],
    [
      "a post blocklist and hidden post media",
      { key: "site", value: { ...site, postBlocklist: ["vpn", "赌博"], hidePostMedia: true } },
      true,
    ],
    [
      "a blank blocklist keyword",
      { key: "site", value: { ...site, postBlocklist: ["  "] } },
      false,
    ],
    [
      "more blocklist keywords than the cap",
      { key: "site", value: { ...site, postBlocklist: Array.from({ length: 101 }, () => "x") } },
      false,
    ],
    ["default payments", { key: "payments", value: settingsDefaults.payments }, true],
    [
      "an unknown network",
      { key: "payments", value: { ...settingsDefaults.payments, cryptoPayNetwork: "devnet" } },
      false,
    ],
    ["an unknown key", { key: "secrets", value: {} }, false],
  ])("%s → valid: %s", (_name, input, valid) => {
    expect(SettingsInput.safeParse(input).success).toBe(valid);
  });
});

describe("loadSettingsView", () => {
  test("reports secrets and the Crypto Pay token as booleans, never their values", async () => {
    core.getSettings.mockResolvedValue(settingsDefaults);
    core.hasCredential.mockResolvedValue(true);
    db.listBotChats.mockResolvedValue([]);

    const view = await loadSettingsView(ctx(), env);

    expect(view.hasCryptoPayToken).toBe(true);
    expect(view.configured).toEqual({
      BOT_TOKEN: true,
      GITHUB_DISPATCH_TOKEN: true,
      SETTINGS_KEY: true,
    });
    const json = JSON.stringify(view);
    for (const secret of [env.BOT_TOKEN, env.GITHUB_DISPATCH_TOKEN, env.SETTINGS_KEY]) {
      expect(json).not.toContain(secret);
    }
    expect(view.superAdminIds).toEqual(["900", "901"]);
    expect(view.cryptoPayWebhookUrl).toBe("https://bot.example.workers.dev/cryptopay/webhook");
  });

  test("offers groups the bot is in for review and channels it administers for publishing", async () => {
    core.getSettings.mockResolvedValue(settingsDefaults);
    core.hasCredential.mockResolvedValue(false);
    const chat = (chatId: string, type: string, status: string) => ({
      chatId,
      type,
      status,
      title: chatId,
      username: null,
      updatedAt: 1,
    });
    db.listBotChats.mockResolvedValue([
      chat("-1", "supergroup", "administrator"),
      chat("-2", "group", "member"),
      chat("-3", "group", "left"),
      chat("-4", "channel", "administrator"),
      chat("-5", "channel", "member"),
      chat("6", "private", "member"),
    ]);

    const view = await loadSettingsView(ctx(), { ...env, SETTINGS_KEY: "" });

    expect(view.reviewChats.map((c) => c.chatId)).toEqual(["-1", "-2"]);
    expect(view.publishChannels.map((c) => c.chatId)).toEqual(["-4"]);
    expect(view.configured.SETTINGS_KEY).toBe(false);
  });
});

describe("saveCryptoPayToken", () => {
  test("stores the token through core and returns no secret", async () => {
    const result = await saveCryptoPayToken(ctx({ SETTINGS_KEY: "k" }), {
      token: "12345:AAtoken-value",
      actor: "tg:900",
    });

    expect(result).toEqual({ ok: true });
    expect(core.setCredential).toHaveBeenCalledWith(expect.anything(), {
      key: "cryptopay_token",
      value: "12345:AAtoken-value",
      actor: "tg:900",
    });
  });

  test("refuses without SETTINGS_KEY", async () => {
    const result = await saveCryptoPayToken(ctx(), { token: "12345:AAtoken", actor: "tg:900" });

    expect(result).toEqual({ ok: false, error: "settings_key_missing" });
    expect(core.setCredential).not.toHaveBeenCalled();
  });
});
