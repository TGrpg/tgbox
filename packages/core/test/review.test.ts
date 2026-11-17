import { env } from "cloudflare:workers";
import {
  approveSubmissions,
  previewSubmission,
  rejectSubmissions,
  setEntryCategoryAndTags,
} from "@tgbox/core";
import {
  createDb,
  createSubmission,
  getEntryByUsername,
  getEntryWithStats,
  getSiteState,
  getSubmission,
  insertApprovedEntry,
  listCategories,
  setUserLocale,
  upsertSetting,
} from "@tgbox/db";
import { settingsDefaults } from "@tgbox/shared";
import { describe, expect, test, vi } from "vitest";
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

/**
 * A D1 binding that counts every call the Workers runtime would bill as a subrequest: each
 * statement execution and each batch.
 */
function countingD1(d1: D1Database) {
  let calls = 0;
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement => {
    for (const method of ["run", "all", "first", "raw"] as const) {
      const original = statement[method].bind(statement) as (...args: unknown[]) => unknown;
      Object.assign(statement, {
        [method]: (...args: unknown[]) => {
          calls++;
          return original(...args);
        },
      });
    }
    const bind = statement.bind.bind(statement);
    statement.bind = (...values: unknown[]) => wrap(bind(...values));
    return statement;
  };
  const binding = {
    prepare: (query: string) => wrap(d1.prepare(query)),
    batch: (statements: D1PreparedStatement[]) => {
      calls++;
      return d1.batch(statements);
    },
  } as unknown as D1Database;
  return { binding, calls: () => calls };
}

describe("admin review queue", () => {
  test("a request cut short after listing leaves the submission pending, and approving again finishes it", async () => {
    const { ctx } = await setup();
    const id = await pending("half_done");
    await env.DB.prepare(
      "CREATE TRIGGER fail_approve BEFORE UPDATE ON submissions BEGIN SELECT RAISE(ABORT, 'injected'); END",
    ).run();
    try {
      await expect(approveSubmissions(ctx, { ids: [id], actor })).rejects.toThrow();
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_approve").run();
    }
    // Still in the queue, so the admin sees it and can try again.
    expect(await getSubmission(db, id)).toMatchObject({ status: "pending" });
    const entry = await getEntryByUsername(db, "half_done");

    expect(await approveSubmissions(ctx, { ids: [id], actor })).toEqual([
      { id, ok: true, entryId: entry?.id },
    ]);
    expect(await getSubmission(db, id)).toMatchObject({ status: "approved" });
  });

  test("a full approval request fits the subrequest limit, channel post and slow GitHub included", async () => {
    const { ctx, dispatches } = await setup({ BOT_TOKEN: "1:t", SITE_URL: "https://tgbox.test" });
    const bot = { ...settingsDefaults.bot, publishChannelId: "-100999" };
    await upsertSetting(db, "bot", JSON.stringify(bot), NOW);
    const ids = [await pending("cost_a"), await pending("cost_b"), await pending("cost_c")];

    const d1 = countingD1(env.DB);
    let fetches = 0;
    // GitHub answers only after the approvals, so build_dispatched_at is never there to throttle.
    const github: (() => void)[] = [];
    const background: Promise<unknown>[] = [];
    const counted = {
      ...ctx,
      db: createDb(d1.binding),
      waitUntil: (promise: Promise<unknown>) => void background.push(promise),
      fetch: async (input: string, init?: RequestInit) => {
        fetches++;
        if (new URL(input).hostname === "api.github.com") {
          await new Promise<void>((resolve) => github.push(resolve));
        }
        return ctx.fetch(input, init);
      },
    };

    const results = await approveSubmissions(counted, { ids, actor });
    for (const release of github) release();
    await Promise.all(background);

    expect(results.every((result) => result.ok)).toBe(true);
    expect(dispatches).toHaveLength(1);
    // Two left for authenticating the admin.
    expect(d1.calls() + fetches).toBeLessThanOrEqual(48);
    vi.restoreAllMocks();
  });

  test("a full rejection request fits the subrequest limit, notices included", async () => {
    const { ctx } = await setup({ BOT_TOKEN: "1:t", SITE_URL: "https://tgbox.test" });
    const ids: number[] = [];
    for (let i = 0; i < 8; i++) ids.push(await pending(`reject_${i}`));
    const d1 = countingD1(env.DB);
    let fetches = 0;
    const background: Promise<unknown>[] = [];
    const counted = {
      ...ctx,
      db: createDb(d1.binding),
      waitUntil: (promise: Promise<unknown>) => void background.push(promise),
      fetch: async (input: string, init?: RequestInit) => {
        fetches++;
        return ctx.fetch(input, init);
      },
    };
    const results = await rejectSubmissions(counted, { ids, reason: "grey", actor });
    await Promise.all(background);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(fetches).toBe(8);
    expect(d1.calls() + fetches).toBeLessThanOrEqual(48);
  });

  test("eight category changes in one request dispatch once and fit the limit", async () => {
    const { ctx, dispatches } = await setup();
    const ids: number[] = [];
    for (let i = 0; i < 8; i++) {
      const { id } = await insertApprovedEntry(db, {
        entry: {
          username: `moved_${i}`,
          kind: "channel",
          categoryId: 1,
          title: "x",
          listedAt: NOW,
        },
        stats: { members: 1, online: null, activityTier: null, statsWrittenAt: NOW },
        tagIds: [],
        now: NOW,
      });
      ids.push(id);
    }
    const target = (await listCategories(db)).find((row) => row.kind === "channel" && row.id !== 1);
    if (!target) throw new Error("no second channel category");

    const d1 = countingD1(env.DB);
    let fetches = 0;
    const github: (() => void)[] = [];
    const background: Promise<unknown>[] = [];
    const counted = {
      ...ctx,
      db: createDb(d1.binding),
      waitUntil: (promise: Promise<unknown>) => void background.push(promise),
      fetch: async (input: string, init?: RequestInit) => {
        fetches++;
        await new Promise<void>((resolve) => github.push(resolve));
        return ctx.fetch(input, init);
      },
    };
    // What $setEntriesCategory does: one taxonomy read, then per entry a read and the change.
    await listCategories(counted.db);
    for (const id of ids) {
      await getEntryWithStats(counted.db, id);
      await setEntryCategoryAndTags(counted, { id, categoryId: target.id, actor });
    }
    for (const release of github) release();
    await Promise.all(background);

    expect(dispatches).toHaveLength(1);
    expect(d1.calls() + fetches).toBeLessThanOrEqual(48);
  });

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

    // The submitter's notice, then the channel post.
    expect(telegram).toHaveLength(2);
    const post = telegram.find((call) => (call.body as { chat_id: unknown }).chat_id === "-100999");
    expect(post).toMatchObject({ method: "sendMessage" });
    const body = post?.body as { text: string; reply_markup: unknown };
    expect(body.text).toContain("🆕 新收录 · 频道");
    expect(body.text).toContain("@fresh_one");
    expect(body.text).toContain("https://tgbox.test/detail/fresh_one/");
    expect(JSON.stringify(body.reply_markup)).toContain("https://t.me/fresh_one");
  });

  test("no channel post without a publish channel or when the entry already existed", async () => {
    const { ctx, telegram } = await setup({ BOT_TOKEN: "1:t", SITE_URL: "https://tgbox.test" });
    const channelPosts = () =>
      telegram.filter((call) => (call.body as { chat_id: unknown }).chat_id === "-100999");
    await approveSubmissions(ctx, { ids: [await pending("quiet_one")], actor });
    expect(channelPosts()).toEqual([]);

    const bot = { ...settingsDefaults.bot, publishChannelId: "-100999" };
    await upsertSetting(db, "bot", JSON.stringify(bot), NOW);
    // A second submission of a leftover entry relists nothing new.
    await env.DB.prepare("UPDATE submissions SET status = 'rejected'").run();
    await approveSubmissions(ctx, { ids: [await pending("quiet_one")], actor });
    expect(channelPosts()).toEqual([]);
    // The submitter still hears about both approvals.
    expect(telegram).toHaveLength(2);
  });

  test("an admin review tells the submitter, in their bot language when they picked one", async () => {
    const { ctx, telegram } = await setup({ BOT_TOKEN: "1:t", SITE_URL: "https://tgbox.test" });
    const id = await pending("told_one");
    const submitter = (await getSubmission(db, id))?.tgUserId ?? 0;
    await setUserLocale(db, submitter, "en", NOW);

    await rejectSubmissions(ctx, { ids: [id], reason: "inactive", actor });

    expect(telegram).toEqual([
      {
        method: "sendMessage",
        body: {
          chat_id: submitter,
          text: "Sorry, your submission @told_one was not approved. Reason: Inactive",
          reply_markup: {
            inline_keyboard: [
              [{ text: "📱 View my submissions", web_app: { url: "https://tgbox.test/app/me/" } }],
            ],
          },
        },
      },
    ]);
  });
});
