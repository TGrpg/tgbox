import { describe, expect, test } from "vitest";
import { goTelegramTarget, isStartPayload, telegramLinks } from "./telegram-links.ts";

describe("opt-in bot start payload transport", () => {
  test.each(["botlist", "a".repeat(64), "A_0-x"])("retains valid %s", (payload) => {
    const input = `https://t.me/TestBot?start=${payload}`;
    expect(isStartPayload(payload)).toBe(true);
    const target = { username: "TestBot", kind: "bot" as const, startPayload: payload };
    const links = telegramLinks(target);
    expect(links.web).toBe(input);
    expect(new URL(links.native).searchParams.get("start")).toBe(payload);
    expect(goTelegramTarget(new URLSearchParams(links.goQuery))).toEqual(target);
    for (const host of ["t.me", "telegram.me", "telegram.dog"]) {
      expect(new URL(links.mirror(host)).searchParams.get("start")).toBe(payload);
    }
  });
  test.each(["", "bad payload", "x".repeat(65), "a/b", "a\0b"])(
    "rejects invalid payload %j",
    (payload) => expect(isStartPayload(payload)).toBe(false),
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
