import { insertApprovedEntry, setEntryStatus } from "@tgbox/db";
import { beforeEach, expect, test } from "vitest";
import { buttons, db, type Harness, startHarness } from "./harness.ts";

let h: Harness;
const user = { id: 5, is_bot: false, first_name: "Searcher", language_code: "zh" };

beforeEach(async () => {
  h = await startHarness();
  const now = Date.now();
  for (const [username, title] of [
    ["daily_news_cn", "每日新闻速递"],
    ["tech_digest", "Tech Digest Weekly"],
    ["hidden_one", "每日隐藏频道"],
  ]) {
    const { id } = await insertApprovedEntry(db, {
      entry: {
        username: username ?? "",
        kind: "channel",
        categoryId: 1,
        title: title ?? "",
        listedAt: now,
      },
      stats: { members: 5000, online: null, activityTier: null, statsWrittenAt: now },
      tagIds: [],
      now,
    });
    if (username === "hidden_one") await setEntryStatus(db, id, "hidden_by_admin", now);
  }
});

const results = () => {
  const call = h.calls("answerInlineQuery")[0];
  const list = call?.payload.results;
  return { call, list: Array.isArray(list) ? list : [] };
};

test("long query matches by phrase and links to the site and Telegram", async () => {
  await h.inline(user, "Digest");
  const { call, list } = results();
  expect(call?.payload.cache_time).toBe(300);
  expect(list).toHaveLength(1);
  expect(list[0]).toMatchObject({ type: "article", title: "Tech Digest Weekly" });
  const urls = buttons({ method: "", payload: list[0] }).map((b) => b.url);
  expect(urls).toEqual(["https://t.me/tech_digest", "https://tgbox.test/detail/tech_digest/"]);
});

test("short Chinese query falls back to substring match and skips hidden entries", async () => {
  await h.inline(user, "每日");
  const { list } = results();
  expect(list.map((r) => r.title)).toEqual(["每日新闻速递"]);
});

test("empty query answers nothing", async () => {
  await h.inline(user, "  ");
  expect(h.telegram).toEqual([]);
});
