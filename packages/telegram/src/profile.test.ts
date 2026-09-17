import { describe, expect, test } from "vitest";
import { fixture } from "./fixtures.ts";
import { parseProfile } from "./profile.ts";

describe("parseProfile", () => {
  test("channel: exact subscriber count, title, description, avatar, verified", () => {
    const profile = parseProfile(fixture("profile-channel.html"), "telegram");
    expect(profile).toMatchObject({
      kind: "channel",
      pageShape: "entity",
      title: "Telegram News",
      description: "The official Telegram on Telegram. Much recursion. Very Telegram. Wow.",
      verified: true,
      members: 9538357,
      online: null,
      monthlyUsers: null,
    });
    expect(profile.avatarUrl).toMatch(/^https:\/\/cdn1\.telesco\.pe\/file\/.+\.jpg$/);
  });

  test("group: members and online, multi-line description", () => {
    const profile = parseProfile(fixture("profile-group.html"), "grammyjs");
    expect(profile).toMatchObject({
      kind: "group",
      pageShape: "entity",
      title: "grammY",
      verified: false,
      members: 1874,
      online: 412,
    });
    expect(profile.description).toContain("grammY.\nThe Telegram Bot Framework.");
  });

  test("bot: monthly users, Start Bot button", () => {
    const profile = parseProfile(fixture("profile-bot.html"), "BotFather");
    expect(profile).toMatchObject({
      kind: "bot",
      pageShape: "entity",
      title: "BotFather",
      verified: true,
      members: null,
      monthlyUsers: 8805452,
    });
  });

  test("user: extra only contains @username", () => {
    const profile = parseProfile(fixture("profile-user.html"), "nikolai");
    expect(profile).toMatchObject({
      kind: "user",
      pageShape: "entity",
      title: "Nikolai",
      avatarUrl: null,
      members: null,
    });
  });

  test("not found: contact page without avatar or extra", () => {
    const profile = parseProfile(fixture("profile-not-found.html"), "zzqq_not_exist_987654");
    expect(profile).toMatchObject({
      kind: null,
      pageShape: "contact",
      title: null,
      avatarUrl: null,
    });
  });

  test("banned-looking: view page without avatar or extra", () => {
    const profile = parseProfile(fixture("profile-banned.html"), "qassambrigades");
    expect(profile).toMatchObject({ kind: null, pageShape: "view", title: null });
  });

  test("page without tgme_page structure is malformed", () => {
    expect(parseProfile(fixture("malformed.html"), "telegram").pageShape).toBe("malformed");
    expect(parseProfile("", "telegram").pageShape).toBe("malformed");
  });

  test.each([
    ["1 234 567 subscribers", 1234567],
    ["12 345 subscribers", 12345],
    ["1,234 subscribers", 1234],
    ["1 subscriber", 1],
  ])("counts with odd separators: %s", (extra, expected) => {
    const html = `<div class="tgme_page"><div class="tgme_page_title"><span dir="auto">X &amp; Y</span></div><div class="tgme_page_extra">${extra}</div></div>`;
    expect(parseProfile(html, "x")).toMatchObject({
      kind: "channel",
      members: expected,
      title: "X & Y",
    });
  });
});
