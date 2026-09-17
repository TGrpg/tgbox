import { describe, expect, test } from "vitest";
import {
  BannerContent,
  BotSettings,
  reviewRecipients,
  SiteSettings,
  settingsDefaults,
  shouldHidePost,
} from "./settings.ts";
import { EntryView, PromoView } from "./site-data.ts";

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
    // The image is optional: banners sold before upload existed keep parsing.
    [{ ...valid, imageUrl: "https://media.tgbox.cc/promos/7.jpg" }, true],
    [{ ...valid, imageUrl: null }, true],
    [{ ...valid, imageUrl: "http://media.tgbox.cc/promos/7.jpg" }, false],
    [{ ...valid, imageUrl: "promos/7.jpg" }, false],
  ])("%j valid: %s", (input, ok) => {
    expect(BannerContent.safeParse(input).success).toBe(ok);
  });

  test("a banner without an image parses without inventing one", () => {
    expect(BannerContent.parse(valid)).toEqual(valid);
  });
});

describe("EntryView translations", () => {
  const entry = {
    username: "durov",
    kind: "channel",
    category: "news",
    tags: [],
    title: "Durov",
    description: "hello",
    lang: "en",
    verified: true,
    avatarUrl: null,
    members: 1,
    online: null,
    activityTier: null,
    tgCreatedAt: null,
    listedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    isPromoted: false,
    posts: [],
    memberHistory: [],
    related: { channels: [], groups: [] },
  };

  test("both translations default to null so a snapshot without them still parses", () => {
    expect(EntryView.parse(entry)).toMatchObject({ descriptionZh: null, descriptionEn: null });
    expect(EntryView.parse({ ...entry, descriptionZh: "\u4f60\u597d" })).toMatchObject({
      descriptionZh: "\u4f60\u597d",
      descriptionEn: null,
    });
  });

  test("a promo without an image defaults to none", () => {
    const promo = { id: "1", title: "t", subtitle: "s", href: "https://t.me/x", sponsored: true };
    expect(PromoView.parse(promo)).toMatchObject({ imageUrl: null });
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

test("stored site settings without the post moderation fields still parse through the defaults", () => {
  const { postBlocklist: _list, hidePostMedia: _media, ...legacy } = settingsDefaults.site;
  const merged = SiteSettings.parse({ ...settingsDefaults.site, ...legacy });
  expect(merged).toMatchObject({ postBlocklist: [], hidePostMedia: false });
  expect(SiteSettings.safeParse({ ...settingsDefaults.site, postBlocklist: [1] }).success).toBe(
    false,
  );
  const tooMany = Array.from({ length: 101 }, (_v, i) => String(i));
  expect(SiteSettings.safeParse({ ...settingsDefaults.site, postBlocklist: tooMany }).success).toBe(
    false,
  );
});

describe("shouldHidePost", () => {
  test.each([
    ["加微信领福利", ["加微信"], true],
    ["Buy cheap FOLLOWERS here", ["followers"], true],
    ["加微信领福利", ["加QQ"], false],
    ["anything at all", [], false],
    ["anything at all", ["   "], false],
    ["每日更新", ["更新", "广告"], true],
  ])("%s against %j → %s", (text, blocklist, hidden) => {
    expect(shouldHidePost(text, blocklist)).toBe(hidden);
  });
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
