import { describe, expect, test } from "vitest";
import { BannerContent, BotSettings, settingsDefaults } from "./settings.ts";

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
