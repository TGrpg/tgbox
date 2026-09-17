import { env } from "cloudflare:workers";
import { approveSubmissions, previewSubmission, rejectSubmissions } from "@tgbox/core";
import {
  createSubmission,
  getEntryByUsername,
  getSiteState,
  getSubmission,
  upsertSetting,
} from "@tgbox/db";
import { settingsDefaults } from "@tgbox/shared";
import { describe, expect, test } from "vitest";
import { actor, auditRows, db, NOW, setup } from "./fake.ts";

async function pending(username: string) {
  const id = await createSubmission(db, {
    tgUserId: 4242,
    username,
    kind: "channel",
    categoryId: 1,
    tagIds: [],
    fetchedTitle: username,
    createdAt: NOW,
  });
  if (id === null) throw new Error("submission not created");
  return id;
}

describe("admin review queue", () => {
  test("bulk approval lists each pending submission once and skips handled ones", async () => {
    const { ctx, dispatches } = await setup();
    const first = await pending("first_one");
    const second = await pending("second_one");

    const results = await approveSubmissions(ctx, { ids: [first, second, first], actor });

    expect(results).toEqual([
      { id: first, ok: true, entryId: expect.any(Number) },
      { id: second, ok: true, entryId: expect.any(Number) },
      { id: first, ok: false },
    ]);
    expect(await getEntryByUsername(db, "first_one")).toMatchObject({ status: "approved" });
    expect(await getEntryByUsername(db, "second_one")).toMatchObject({ status: "approved" });
    expect(await getSiteState(db, "dirty_since")).toBe(String(NOW));
    expect(dispatches).toHaveLength(1);
    expect((await auditRows()).map((row) => row.action)).toEqual([
      "submission.approve",
      "submission.approve",
    ]);
  });

  test("bulk rejection records the reason and skips handled ones", async () => {
    const { ctx } = await setup();
    const id = await pending("reject_me");

    expect(await rejectSubmissions(ctx, { ids: [id, id], reason: "grey", actor })).toEqual([
      { id, ok: true },
      { id, ok: false },
    ]);
    expect(await getSubmission(db, id)).toMatchObject({ status: "rejected", rejectReason: "grey" });
  });

  test("preview fetches the live profile and recent posts without writing", async () => {
    const { ctx, tme } = await setup();

    const preview = await previewSubmission(ctx, { username: "live_channel", kind: "channel" });

    expect(preview).toMatchObject({
      liveness: "active",
      kind: "channel",
      profile: { title: "Telegram News" },
    });
    expect(preview.posts?.length).toBeGreaterThan(0);
    expect(preview.posts?.length).toBeLessThanOrEqual(5);
    expect(tme).toEqual(["/live_channel", "/s/live_channel"]);
    expect(await getEntryByUsername(db, "live_channel")).toBeUndefined();
    expect(await auditRows()).toEqual([]);
  });

  test("approving from the admin posts each new entry to the publish channel", async () => {
    const { ctx, telegram } = await setup({ BOT_TOKEN: "1:t", SITE_URL: "https://tgbox.test/" });
    const bot = { ...settingsDefaults.bot, publishChannelId: "-100999" };
    await upsertSetting(db, "bot", JSON.stringify(bot), NOW);
    const id = await pending("fresh_one");

    await approveSubmissions(ctx, { ids: [id], actor });

    expect(telegram).toHaveLength(1);
    expect(telegram[0]).toMatchObject({ method: "sendMessage", body: { chat_id: "-100999" } });
    const body = telegram[0]?.body as { text: string; reply_markup: unknown };
    expect(body.text).toContain("🆕 新收录 · 频道");
    expect(body.text).toContain("@fresh_one");
    expect(body.text).toContain("https://tgbox.test/detail/fresh_one/");
    expect(JSON.stringify(body.reply_markup)).toContain("https://t.me/fresh_one");
  });

  test("no channel post without a publish channel or when the entry already existed", async () => {
    const { ctx, telegram } = await setup({ BOT_TOKEN: "1:t", SITE_URL: "https://tgbox.test" });
    await approveSubmissions(ctx, { ids: [await pending("quiet_one")], actor });
    expect(telegram).toEqual([]);

    const bot = { ...settingsDefaults.bot, publishChannelId: "-100999" };
    await upsertSetting(db, "bot", JSON.stringify(bot), NOW);
    // A second submission of a leftover entry relists nothing new.
    await env.DB.prepare("UPDATE submissions SET status = 'rejected'").run();
    await approveSubmissions(ctx, { ids: [await pending("quiet_one")], actor });
    expect(telegram).toEqual([]);
  });
});
