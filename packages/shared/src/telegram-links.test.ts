import { describe, expect, test } from "vitest";
import { goTelegramTarget, parseStartPayload, telegramLinks } from "./telegram-links.ts";
import { parseTelegramRef } from "./username.ts";

describe("opt-in bot start payload transport", () => {
  test.each(["botlist", "a".repeat(64), "A_0-x"])("retains valid %s", (payload) => {
    const input = `https://t.me/TestBot?start=${payload}`;
    expect(parseTelegramRef(input)).toBe("TestBot");
    expect(parseStartPayload(input)).toBe(payload);
    const target = { username: "TestBot", kind: "bot" as const, startPayload: payload };
    const links = telegramLinks(target);
    expect(links.web).toBe(input);
    expect(new URL(links.native).searchParams.get("start")).toBe(payload);
    expect(goTelegramTarget(new URLSearchParams(links.goQuery))).toEqual(target);
    for (const host of ["t.me", "telegram.me", "telegram.dog"]) {
      expect(new URL(links.mirror(host)).searchParams.get("start")).toBe(payload);
    }
  });
  test.each([
    "https://t.me/TestBot?start=",
    "https://t.me/TestBot?start=a&start=b",
    "https://t.me/TestBot?start=a&%73tart=b",
    "https://t.me/TestBot?start=a%20b",
    `https://t.me/TestBot?start=${"x".repeat(65)}`,
    "https://t.me/TestBot?start=x%2Fy",
    "ftp://t.me/TestBot?start=botlist",
    "https://t.me/s/TestBot?start=botlist",
    "https://t.me/TestBot/12?start=botlist",
    "https://t.me/iv?start=botlist",
    "https://t.me/joinchat/hash?start=botlist",
    "https://evil.test/TestBot?start=botlist",
    "https://user:secret@t.me/TestBot?start=botlist",
  ])("rejects invalid or ambiguous input %s", (input) => {
    expect(parseStartPayload(input)).toBeUndefined();
  });
  test.each(["@TestBot", "TestBot", "t.me/TestBot", "https://t.me/TestBot?unknown=value"])(
    "legacy reference %s has no payload",
    (input) => expect(parseStartPayload(input)).toBeNull(),
  );
  test("channels, groups and legacy bots keep bare links, never arbitrary query strings", () => {
    for (const kind of ["channel", "group", "bot"] as const) {
      const links = telegramLinks({ username: "sample", kind });
      expect(links.web).toBe("https://t.me/sample");
      expect(links.native).toBe("tg://resolve?domain=sample");
    }
    for (const kind of ["channel", "group"] as const) {
      expect(telegramLinks({ username: "sample", kind, startPayload: "botlist" }).web).toBe(
        "https://t.me/sample",
      );
    }
  });
  test.each([
    "u=TestBot&start=a",
    "u=TestBot&kind=channel&start=a",
    "u=TestBot&kind=bot&start=",
    "u=TestBot&u=OtherBot",
    "u=TestBot&kind=bot&start=a&start=b",
    "u=TestBot&kind=bot&kind=group&start=a",
  ])("rejects invalid Go transport %s", (query) =>
    expect(goTelegramTarget(new URLSearchParams(query))).toBeNull(),
  );
});
