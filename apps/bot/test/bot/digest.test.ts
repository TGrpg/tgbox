import { beforeEach, describe, expect, test } from "vitest";
import { type Harness, setBotSettings, startHarness } from "./harness.ts";

const HOURLY = "0 * * * *";
// 2026-09-17 01:00 UTC = 09:00 Beijing
const DIGEST_TIME = Date.UTC(2026, 8, 17, 1);
const HOUR = 60 * 60 * 1000;

const item = (username: string, patch: Record<string, unknown> = {}) => ({
  username,
  kind: "channel",
  title: `${username} <title>`,
  members: 1000,
  growth: null,
  growthPct: null,
  listedAt: new Date(DIGEST_TIME - 30 * 24 * HOUR).toISOString(),
  activityTier: 3,
  ...patch,
});

const rankings = (patch: Record<string, unknown> = {}) => ({
  generatedAt: new Date(DIGEST_TIME - HOUR).toISOString(),
  weeklyGrowth: [],
  monthlyGrowth: [],
  newest: [],
  active: [],
  ...patch,
});

const digests = (h: Harness) =>
  h.calls("sendMessage").filter((c) => String(c.payload.text).startsWith("📊 TGbox 日报"));

let h: Harness;
beforeEach(async () => {
  h = await startHarness();
  await setBotSettings({ publishChannelId: "-100999" });
});

describe("daily channel digest", () => {
  test("posts today's new entries and the weekly growth top 5 at 09:00 Beijing", async () => {
    h.serveSite(() =>
      Response.json(
        rankings({
          newest: [
            item("brand_new", { listedAt: new Date(DIGEST_TIME - 2 * HOUR).toISOString() }),
            item("last_week", { listedAt: new Date(DIGEST_TIME - 50 * HOUR).toISOString() }),
          ],
          weeklyGrowth: Array.from({ length: 7 }, (_v, i) =>
            item(`grower_${i}`, { growth: 5000 - i * 100 }),
          ),
        }),
      ),
    );

    await h.scheduled(DIGEST_TIME, HOURLY);

    expect(h.site).toEqual(["/data/rankings.json"]);
    const [digest] = digests(h);
    expect(digests(h)).toHaveLength(1);
    expect(digest?.payload).toMatchObject({ chat_id: "-100999", parse_mode: "HTML" });
    const text = String(digest?.payload.text);
    expect(text).toContain("今日新收录");
    expect(text).toContain(
      '<a href="https://tgbox.test/detail/brand_new/">brand_new &lt;title&gt;</a> @brand_new',
    );
    expect(text).not.toContain("last_week");
    expect(text).toContain("本周涨粉榜");
    expect(text).toContain("@grower_0 +5,000");
    expect(text).toContain("@grower_4 +4,600");
    expect(text).not.toContain("grower_5");
    expect(text).toContain('href="https://tgbox.test/rank/"');
  });

  test("only runs on the 01:00 UTC hourly cron and when enabled", async () => {
    h.serveSite(() => Response.json(rankings({ weeklyGrowth: [item("grower", { growth: 10 })] })));
    await h.scheduled(DIGEST_TIME + HOUR, HOURLY);
    await h.scheduled(DIGEST_TIME, "* * * * *");
    await setBotSettings({ publishChannelId: "-100999", dailyDigest: false });
    await h.scheduled(DIGEST_TIME, HOURLY);
    await setBotSettings({ publishChannelId: null });
    await h.scheduled(DIGEST_TIME, HOURLY);

    expect(h.site).toEqual([]);
    expect(digests(h)).toEqual([]);
  });

  test.each([
    ["both sections are empty", () => Response.json(rankings({ newest: [item("old_one")] }))],
    ["the site returns an error", () => new Response("oops", { status: 500 })],
    ["the JSON is invalid", () => new Response("{not json")],
    ["the JSON has the wrong shape", () => Response.json({ newest: "nope" })],
  ])("nothing is posted when %s", async (_name, respond) => {
    h.serveSite(respond);
    await h.scheduled(DIGEST_TIME, HOURLY);
    expect(h.site).toEqual(["/data/rankings.json"]);
    expect(digests(h)).toEqual([]);
  });
});
