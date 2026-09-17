import { expect, test } from "vitest";
import { isBotTraffic, promoClickUrl, promoRedirect, promoTarget } from "./promo-link.ts";

const NOW = Date.UTC(2026, 8, 17);
const DAY = 24 * 60 * 60 * 1000;

const banner = { title: "Rocket", subtitle: "Fast nodes", href: "https://t.me/rocketvpn" };
const live = { startsAt: NOW - DAY, endsAt: NOW + DAY };

test("promoClickUrl points at the redirect route", () => {
  expect(promoClickUrl("41")).toBe("/r/41");
});

test.each([
  [
    "pin goes to Telegram",
    { kind: "pin", entryUsername: "devnotes", banner: null },
    "https://t.me/devnotes",
  ],
  ["banner goes to its own link", { kind: "banner", entryUsername: null, banner }, banner.href],
  ["pin without an entry", { kind: "pin", entryUsername: null, banner: null }, null],
  ["banner without content", { kind: "banner", entryUsername: null, banner: null }, null],
  [
    "javascript: href is refused",
    { kind: "banner", entryUsername: null, banner: { ...banner, href: "javascript:alert(1)" } },
    null,
  ],
  [
    "relative href is refused",
    { kind: "banner", entryUsername: null, banner: { ...banner, href: "/admin" } },
    null,
  ],
] as const)("promoTarget: %s", (_name, promotion, expected) => {
  expect(promoTarget(promotion)).toBe(expected);
});

test.each([
  ["GET", "Mozilla/5.0 (iPhone)", false],
  ["GET", null, false],
  ["HEAD", "Mozilla/5.0 (iPhone)", true],
  ["GET", "TelegramBot (like TwitterBot)", true],
  ["GET", "Mozilla/5.0 (compatible; Googlebot/2.1)", true],
  ["GET", "Twitterbot/1.0 link preview", true],
  ["GET", "Mediapartners spider", true],
])("isBotTraffic(%s, %s) → %s", (method, userAgent, expected) => {
  expect(isBotTraffic(method, userAgent)).toBe(expected);
});

test("a live promotion redirects to its target and counts the click", () => {
  expect(
    promoRedirect({
      promotion: { kind: "banner", entryUsername: null, banner, ...live },
      now: NOW,
      method: "GET",
      userAgent: "Mozilla/5.0",
    }),
  ).toEqual({ location: banner.href, record: true });
});

test("bot traffic still gets the redirect, but no click", () => {
  expect(
    promoRedirect({
      promotion: { kind: "banner", entryUsername: null, banner, ...live },
      now: NOW,
      method: "GET",
      userAgent: "Googlebot/2.1",
    }),
  ).toEqual({ location: banner.href, record: false });
});

test.each([
  ["unknown id", null, NOW],
  [
    "expired",
    { kind: "banner", entryUsername: null, banner, startsAt: NOW - 2 * DAY, endsAt: NOW },
    NOW,
  ],
  [
    "not started yet",
    { kind: "banner", entryUsername: null, banner, startsAt: NOW + DAY, endsAt: NOW + 2 * DAY },
    NOW,
  ],
  [
    "no usable target",
    { kind: "pin", entryUsername: null, banner: null, startsAt: NOW - DAY, endsAt: NOW + DAY },
    NOW,
  ],
] as const)("%s goes home without a click", (_name, promotion, now) => {
  expect(promoRedirect({ promotion, now, method: "GET", userAgent: "Mozilla/5.0" })).toEqual({
    location: "/",
    record: false,
  });
});
