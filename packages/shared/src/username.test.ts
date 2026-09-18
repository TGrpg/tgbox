import { describe, expect, test } from "vitest";
import { parseTelegramRef } from "./username.ts";

describe("parseTelegramRef", () => {
  test.each([
    ["https://t.me/durov_news", "durov_news"],
    ["http://t.me/durov_news", "durov_news"],
    ["t.me/durov_news", "durov_news"],
    ["  t.me/durov_news/123  ", "durov_news"],
    ["@durov_news", "durov_news"],
    ["telegram.me/durov_news", "durov_news"],
    ["https://telegram.dog/durov_news", "durov_news"],
    ["https://t.me/s/durov_news", "durov_news"],
    ["t.me/durov_news?start=abc", "durov_news"],
    ["durov_news", "durov_news"],
    // Four characters: short but real (@kuai is a live bot).
    ["@kuai", "kuai"],
    ["https://t.me/kuai", "kuai"],
    ["@abcd", "abcd"],
    // Three characters: Telegram's own inline bots.
    ["@gif", "gif"],
    ["https://t.me/vid", "vid"],
  ])("accepts %s", (input, expected) => {
    expect(parseTelegramRef(input)).toBe(expected);
  });

  test.each([
    ["", "empty"],
    ["https://t.me/+AbCdEfGhIjK", "invite hash"],
    ["https://t.me/joinchat/AbCdEfGhIjK", "joinchat link"],
    ["@ab", "too short"],
    // t.me's reserved one- and two-letter paths are not usernames.
    ["https://t.me/iv?url=https://example.com", "instant view path"],
    ["https://t.me/k/", "web client path"],
    [`@a${"b".repeat(32)}`, "too long"],
    ["@1durov", "starts with digit"],
    ["@durov-news", "invalid character"],
    ["https://example.com/durov_news", "other host"],
    ["https://t.me/", "no username"],
  ])("rejects %s (%s)", (input) => {
    expect(parseTelegramRef(input)).toBeNull();
  });
});
