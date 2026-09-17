import { createHmac } from "node:crypto";
import { expect, test } from "vitest";
import { verifyInitData } from "./mini-app.ts";

const NOW = Date.UTC(2026, 8, 17);
const NOW_S = NOW / 1000;
const BOT_TOKEN = "123456:secret";

/** Builds a launch string signed the way Telegram signs it. */
function initData(
  fields: { user?: unknown; authDate?: number; startParam?: string },
  token = BOT_TOKEN,
) {
  const params = new URLSearchParams({
    query_id: "AAE",
    auth_date: String(fields.authDate ?? NOW_S - 60),
  });
  if (fields.user !== undefined) params.set("user", JSON.stringify(fields.user));
  if (fields.startParam !== undefined) params.set("start_param", fields.startParam);
  const checkString = [...params.entries()]
    .map((pair) => pair.join("="))
    .sort()
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  params.set("hash", createHmac("sha256", secret).update(checkString).digest("hex"));
  return params.toString();
}

const alice = {
  id: 900,
  first_name: "Alice",
  username: "alice",
  language_code: "zh-hans",
  photo_url: "https://t.me/i/userpic/320/alice.jpg",
};

test("a valid launch string returns the whole user", async () => {
  const data = initData({ user: alice, startParam: "promote" });

  expect(await verifyInitData(data, BOT_TOKEN, NOW)).toEqual({
    id: 900,
    firstName: "Alice",
    username: "alice",
    languageCode: "zh-hans",
    photoUrl: "https://t.me/i/userpic/320/alice.jpg",
    startParam: "promote",
  });
});

test("fields Telegram omitted come back as null", async () => {
  const data = initData({ user: { id: 42, first_name: "Bo" } });

  expect(await verifyInitData(data, BOT_TOKEN, NOW)).toEqual({
    id: 42,
    firstName: "Bo",
    username: null,
    languageCode: null,
    photoUrl: null,
    startParam: null,
  });
});

test("a launch from just under 24 hours ago is still accepted", async () => {
  const data = initData({ user: alice, authDate: NOW_S - 24 * 3600 + 30 });

  expect(await verifyInitData(data, BOT_TOKEN, NOW)).not.toBeNull();
});

test("a client clock a few seconds ahead is tolerated", async () => {
  const data = initData({ user: alice, authDate: NOW_S + 30 });

  expect(await verifyInitData(data, BOT_TOKEN, NOW)).not.toBeNull();
});

test.each([
  ["a tampered hash", initData({ user: alice }).replace(/hash=./, "hash=0")],
  [
    "tampered fields under an intact hash",
    initData({ user: { id: 1 } }).replace("%22id%22%3A1", "%22id%22%3A900"),
  ],
  ["no hash at all", "user=%7B%22id%22%3A900%7D&auth_date=1"],
  ["a signature from another bot", initData({ user: alice }, "999:other")],
  ["a launch older than 24 hours", initData({ user: alice, authDate: NOW_S - 25 * 3600 })],
  ["a launch dated in the future", initData({ user: alice, authDate: NOW_S + 3600 })],
  ["a missing auth_date", initData({ user: alice, authDate: Number.NaN })],
  ["no user", initData({})],
  ["a user without an id", initData({ user: { first_name: "Alice" } })],
])("rejects %s", async (_name, data) => {
  expect(await verifyInitData(data, BOT_TOKEN, NOW)).toBeNull();
});

test("rejects everything when the bot token is unset", async () => {
  expect(await verifyInitData(initData({ user: alice }), undefined, NOW)).toBeNull();
  expect(await verifyInitData(initData({ user: alice }), "", NOW)).toBeNull();
});
