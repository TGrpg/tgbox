import { describe, expect, test } from "vitest";
import { BannerContent, BotSettings, reviewRecipients, settingsDefaults } from "./settings.ts";

describe("BannerContent", () => {
  const valid = { title: "新频道", subtitle: "每天更新", href: "https://t.me/new_channel" };

  test.each([
    [valid, true],
    [{ ...valid, href: "https://example.com/page?x=1" }, true],
    [{ ...valid, title: "x".repeat(20), subtitle: "y".repeat(40) }, true],
    [{ ...valid, title: "x".repeat(21) }, false],
    [{ ...valid, subtitle: "y".repeat(41) }, false],
    [{ ...valid, title: "  " }, false],
    [{ ...valid, href: "http://t.me/new_channel" }, false],
    [{ ...valid, href: "t.me/new_channel" }, false],
    [{ ...valid, href: "javascript:alert(1)" }, false],
  ])("%j valid: %s", (input, ok) => {
    expect(BannerContent.safeParse(input).success).toBe(ok);
  });
});

test("defaults satisfy the settings schemas", () => {
  expect(BotSettings.parse(settingsDefaults.bot)).toEqual(settingsDefaults.bot);
  expect(BotSettings.safeParse({ ...settingsDefaults.bot, extraAdminIds: ["-1"] }).success).toBe(
    false,
  );
});

test("stored bot settings without the newer fields still parse through the defaults", () => {
  const { reviewMode: _mode, dailyDigest: _digest, ...legacy } = settingsDefaults.bot;
  const merged = BotSettings.parse({ ...settingsDefaults.bot, ...legacy, reviewChatId: "-100" });
  expect(merged).toMatchObject({ reviewMode: "chat", dailyDigest: true, reviewChatId: "-100" });
});

describe("reviewRecipients", () => {
  const env = { ADMIN_IDS: " 900, 901 ,", ADMIN_CHAT_ID: "-100500" };
  const bot = settingsDefaults.bot;

  const cases: [
    string,
    Partial<BotSettings>,
    typeof env | { ADMIN_IDS: string },
    string[],
    string,
  ][] = [
    ["chat mode uses the settings chat", { reviewChatId: "-100777" }, env, ["-100777"], "chat"],
    ["chat mode falls back to ADMIN_CHAT_ID", {}, env, ["-100500"], "chat"],
    [
      "chat mode without any chat DMs the admins",
      { extraAdminIds: ["902", "900"] },
      { ADMIN_IDS: "900,901" },
      ["900", "901", "902"],
      "admins",
    ],
    [
      "admins mode ignores the chat",
      { reviewMode: "admins", reviewChatId: "-100777" },
      env,
      ["900", "901"],
      "admins",
    ],
  ];
  test.each(cases)("%s", (_name, patch, envValue, chatIds, mode) => {
    expect(reviewRecipients({ ...bot, ...patch }, envValue)).toEqual({ mode, chatIds });
  });

  test("private copies are capped at 10", () => {
    const extraAdminIds = Array.from({ length: 15 }, (_v, i) => String(1000 + i));
    const { chatIds } = reviewRecipients({ ...bot, reviewMode: "admins", extraAdminIds }, {});
    expect(chatIds).toHaveLength(10);
  });
});
