import type { APIContext } from "astro";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const db = vi.hoisted(() => ({
  createDb: vi.fn(() => ({})),
  getPromotion: vi.fn(),
  recordClick: vi.fn(),
  clickDay: (ms: number) => new Date(ms).toISOString().slice(0, 10),
}));
vi.mock("@tgbox/db", () => db);

const { ALL } = await import("../src/pages/r/[id].ts");

// Deliberately not today, so the tests fail if the clock is not actually frozen.
const NOW = Date.UTC(2026, 4, 4, 12);
const DAY = 24 * 60 * 60 * 1000;
const banner = { title: "Rocket", subtitle: "Fast nodes", href: "https://t.me/rocketvpn" };

const call = (id: string, init?: { method?: string; userAgent?: string }) => {
  const request = new Request(`https://tgbox.cc/r/${id}`, {
    method: init?.method ?? "GET",
    headers: init?.userAgent ? { "user-agent": init.userAgent } : {},
  });
  // Only `params` and `request` are read; the rest of APIContext never reaches the handler.
  return ALL({ params: { id }, request } as unknown as APIContext);
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ now: NOW });
});

afterEach(() => vi.useRealTimers());

test("a live promotion redirects to its target and records exactly one click", async () => {
  db.getPromotion.mockResolvedValue({
    id: 41,
    kind: "banner",
    entryUsername: null,
    banner,
    startsAt: NOW - DAY,
    endsAt: NOW + DAY,
  });

  const response = await call("41", { userAgent: "Mozilla/5.0 (iPhone)" });

  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe(banner.href);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(db.getPromotion).toHaveBeenCalledWith(expect.anything(), 41);
  expect(db.recordClick).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
    promotionId: 41,
    day: "2026-05-04",
  });
});

test("a pin sends the visitor to Telegram", async () => {
  db.getPromotion.mockResolvedValue({
    id: 7,
    kind: "pin",
    entryUsername: "devnotes",
    banner: null,
    startsAt: NOW - DAY,
    endsAt: NOW + DAY,
  });

  const response = await call("7", { userAgent: "Mozilla/5.0" });

  expect(response.headers.get("location")).toBe("https://t.me/devnotes");
  expect(db.recordClick).toHaveBeenCalledOnce();
});

test("an expired promotion goes home and is not counted", async () => {
  db.getPromotion.mockResolvedValue({
    id: 41,
    kind: "banner",
    entryUsername: null,
    banner,
    startsAt: NOW - 2 * DAY,
    endsAt: NOW - DAY,
  });

  const response = await call("41", { userAgent: "Mozilla/5.0" });

  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe("/");
  expect(db.recordClick).not.toHaveBeenCalled();
});

test("an unknown id goes home without touching the counter", async () => {
  db.getPromotion.mockResolvedValue(undefined);

  expect((await call("999", { userAgent: "Mozilla/5.0" })).headers.get("location")).toBe("/");
  expect(db.recordClick).not.toHaveBeenCalled();
});

test.each([
  ["a crawler", { userAgent: "Mozilla/5.0 (compatible; Googlebot/2.1)" }],
  ["a link unfurler", { userAgent: "TelegramBot (like TwitterBot)" }],
  ["a HEAD probe", { method: "HEAD", userAgent: "Mozilla/5.0" }],
])("%s is redirected but not counted", async (_name, init) => {
  db.getPromotion.mockResolvedValue({
    id: 41,
    kind: "banner",
    entryUsername: null,
    banner,
    startsAt: NOW - DAY,
    endsAt: NOW + DAY,
  });

  const response = await call("41", init);

  expect(response.headers.get("location")).toBe(banner.href);
  expect(db.recordClick).not.toHaveBeenCalled();
});

test.each(["abc", "-1", "0", "1.5", ""])("a malformed id (%s) never reaches D1", async (id) => {
  const response = await call(id);

  expect(response.headers.get("location")).toBe("/");
  expect(db.getPromotion).not.toHaveBeenCalled();
  expect(db.recordClick).not.toHaveBeenCalled();
});
