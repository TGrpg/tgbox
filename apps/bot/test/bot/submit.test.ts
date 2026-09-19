import {
  addToBlacklist,
  createSubmission,
  getBotDraft,
  listCategories,
  listTags,
  submissions,
  tags,
} from "@tgbox/db";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import {
  ADMIN,
  ADMIN_CHAT_ID,
  buttons,
  db,
  type Harness,
  setBotSettings,
  startHarness,
} from "./harness.ts";

const owner = {
  id: 42,
  is_bot: false,
  first_name: "Owner",
  username: "owner",
  language_code: "zh-hans",
};

let h: Harness;
beforeEach(async () => {
  h = await startHarness();
});

const press = async (from: typeof owner, prefix: string, index = 0) => {
  const button = h.lastButtons().filter((b) => b.callback_data?.startsWith(prefix))[index];
  if (!button?.callback_data) throw new Error(`no ${prefix} button`);
  await h.callback(from, button.callback_data);
  return button;
};

describe("submission flow", () => {
  test("tag keyboard and summary use the taxonomy stored in D1", async () => {
    // Whatever the keyboard offers first for this category, renamed in D1 behind its back.
    await h.message(owner, "https://t.me/sample_channel");
    await press(owner, "sc:", 0);
    const shown = h.lastButtons()[0]?.text;
    const first = (await listTags(db)).find((tag) => tag.nameZh === shown);
    if (!first) throw new Error("no tags");
    await db.update(tags).set({ nameZh: "改过的标签" }).where(eq(tags.id, first.id));

    await h.message(owner, "https://t.me/sample_channel");
    await press(owner, "sc:", 0);
    expect(h.lastButtons().map((b) => b.text)).toContain("改过的标签");
    await press(owner, "st:", 0);
    await press(owner, "sd:");
    expect(h.lastText()).toContain("改过的标签");
    await db.update(tags).set({ nameZh: first.nameZh }).where(eq(tags.id, first.id));
  });

  test("link → category → tags → confirm creates a pending submission and notifies admins", async () => {
    await h.message(owner, "https://t.me/sample_channel");
    expect(h.lastText()).toContain("Telegram News");
    expect(h.tme).toEqual(["/sample_channel", "/s/sample_channel"]);

    const channelCategories = (await listCategories(db)).filter((c) => c.kind === "channel");
    expect(h.lastButtons().filter((b) => b.callback_data?.startsWith("sc:"))).toHaveLength(
      channelCategories.length,
    );
    for (const b of h.lastButtons())
      expect(new TextEncoder().encode(b.callback_data).length).toBeLessThanOrEqual(64);

    await press(owner, "sc:", 1);
    await press(owner, "st:", 0);
    await press(owner, "st:", 2);
    await press(owner, "sd:");
    expect(h.lastText()).toContain("影音资源");

    // Go back and change the category from the summary.
    await press(owner, "se:");
    await press(owner, "sc:", 0);
    expect(h.lastText()).toContain("资讯新闻");

    const confirm = h.lastButtons().find((b) => b.callback_data?.startsWith("so:"));
    h.reset();
    await h.callback(owner, confirm?.callback_data ?? "");
    expect(h.calls("editMessageText")[0]?.payload.text).toContain("已提交");

    const [row] = await db
      .select()
      .from(submissions)
      .where(eq(submissions.username, "sample_channel"));
    expect(row).toMatchObject({
      status: "pending",
      tgUserId: owner.id,
      kind: "channel",
      categoryId: channelCategories[0]?.id,
      fetchedTitle: "Telegram News",
    });
    expect(row?.tagIds).toHaveLength(2);

    const adminPost = h
      .calls("sendMessage")
      .find((c) => c.payload.chat_id === String(ADMIN_CHAT_ID));
    expect(adminPost?.payload.text).toContain("sample_channel");
    expect(buttons(adminPost).map((b) => b.callback_data)).toEqual([
      `ra:${row?.id}`,
      `rj:${row?.id}`,
    ]);
    expect(row?.adminMessageId).toBeTypeOf("number");
    expect(await getBotDraft(db, owner.id, Date.now())).toBeUndefined();
  });

  test("the guessed category leads the keyboard with a ✨ and costs no AI call", async () => {
    await h.message(owner, "https://t.me/sample_channel");

    // "Telegram News" is unambiguous to the keyword pass, so the model is never asked.
    expect(h.aiCalls).toHaveLength(0);
    const [first] = h.lastButtons().filter((b) => b.callback_data?.startsWith("sc:"));
    expect(first?.text).toBe("✨ 资讯新闻");
    expect(h.lastText()).toContain("可以改");
    expect(h.lastButtons().filter((b) => b.text.startsWith("✨"))).toHaveLength(1);
  });

  test("a Traditional user sees the seed categories and tags in Traditional", async () => {
    const reader = { ...owner, id: 43, username: "reader", language_code: "zh-hant" };
    await h.message(reader, "https://t.me/sample_channel");
    const labels = h.lastButtons().map((b) => b.text);
    expect(labels).toContain("✨ 資訊新聞");
    expect(labels).toContain("影音資源");
    await press(reader, "sc:", 0);
    await press(reader, "st:", 0);
    await press(reader, "sd:");
    expect(h.lastText()).toContain("資訊新聞");
  });

  test("a category nobody can guess leaves the keyboard untouched", async () => {
    // The model answers like the translation fake does — no `response` field — which is exactly
    // the "unusable answer" case: no suggestion, rather than a wrong one.
    await h.message(owner, "https://t.me/grammyjs");
    expect(h.lastButtons().some((b) => b.text.startsWith("✨"))).toBe(false);
    expect(h.lastText()).not.toContain("可以改");
  });

  test("the webhook answers before the t.me lookup finishes", async () => {
    const release = h.holdTme();
    const { response, done } = await h.startMessage(owner, "https://t.me/slow_channel");
    expect(response.status).toBe(200);
    expect(h.lastText()).toContain("正在检查 @slow_channel");
    expect(h.tme).toEqual(["/slow_channel"]);
    expect(await getBotDraft(db, owner.id, Date.now())).toBeUndefined();

    release();
    await done;
    // The "checking" message (the harness's first message id) is edited into the result.
    expect(h.calls("sendMessage")).toHaveLength(1);
    const result = h.calls("editMessageText").at(-1);
    expect(result?.payload.message_id).toBe(5001);
    expect(result?.payload.text).toContain("Telegram News");
    expect(await getBotDraft(db, owner.id, Date.now())).toBeDefined();
  });

  test("a rejected Bot API call doesn't fail the webhook or lose the draft", async () => {
    h.rejectTelegram();
    const response = await h.message(owner, "https://t.me/blocked_owner_channel");
    expect(response.status).toBe(200);
    expect((await h.message(owner, "/start")).status).toBe(200);
    expect(await getBotDraft(db, owner.id, Date.now())).toMatchObject({
      step: "choosing_category",
    });
  });

  test("confirming still reaches the review group when Telegram rejects the answer", async () => {
    await h.message(owner, "@flaky_answer_channel");
    await press(owner, "sc:");
    await press(owner, "sd:");
    h.rejectTelegram();
    await press(owner, "so:");

    const [row] = await db
      .select()
      .from(submissions)
      .where(eq(submissions.username, "flaky_answer_channel"));
    expect(row?.status).toBe("pending");
    const adminPost = h
      .calls("sendMessage")
      .find((c) => c.payload.chat_id === String(ADMIN_CHAT_ID));
    expect(adminPost?.payload.text).toContain("flaky_answer_channel");
  });

  test("the tag keyboard leads with the category's tags without changing what a mask means", async () => {
    // The mask indexes into `listTags` in id order, and drafts and callback data carry it around.
    // Paging over a per-category display order must not touch that: a draft tagged under one
    // category has to resolve to the same tags after the category (and the order) changes.
    await h.message(owner, "https://t.me/sample_channel");
    await press(owner, "sc:", 0); // the ✨ guess: 资讯新闻

    const newsHints = ["每日早报", "财经", "科学", "数码硬件", "网络安全", "体育"];
    expect(
      h
        .lastButtons()
        .map((b) => b.text)
        .slice(0, newsHints.length),
    ).toEqual(newsHints);

    await press(owner, "st:", 0); // 每日早报
    await press(owner, "st:", 1); // 财经
    await press(owner, "sd:");
    expect(h.lastText()).toContain("每日早报");
    expect(h.lastText()).toContain("财经");

    // Move the submission to a category whose tags are completely different.
    await press(owner, "se:");
    const tech = h.lastButtons().find((b) => b.text === "开发编程");
    await h.callback(owner, tech?.callback_data ?? "");
    expect(h.lastText()).toContain("开发编程");
    expect(h.lastText()).toContain("每日早报");
    expect(h.lastText()).toContain("财经");

    await press(owner, "sg:");
    const techHints = ["编程", "开源", "网络安全", "主机VPS", "Linux", "数码硬件", "AI编程"];
    expect(
      h
        .lastButtons()
        .map((b) => b.text)
        .slice(0, techHints.length),
    ).toEqual(techHints);
    // The two selected tags are not 开发编程 tags, so they moved off the first page entirely —
    // the ✅ marks travel with the tags, not with the positions.
    expect(h.lastButtons().filter((b) => b.text.startsWith("✅"))).toHaveLength(0);

    await press(owner, "sd:");
    await press(owner, "so:");
    const [row] = await db
      .select()
      .from(submissions)
      .where(eq(submissions.username, "sample_channel"));
    const live = await listTags(db);
    const idOf = (slug: string) => live.find((tag) => tag.slug === slug)?.id;
    expect(row?.tagIds?.slice().sort()).toEqual([idOf("daily-news"), idOf("finance")].sort());
  });

  test("tag selection stops at five", async () => {
    await h.message(owner, "@five_tags");
    await press(owner, "sc:");
    for (let i = 0; i < 6; i++) await press(owner, "st:", i);
    expect(h.lastButtons().filter((b) => b.text.startsWith("✅"))).toHaveLength(5);
  });

  test("replies in English for English users", async () => {
    await h.message({ ...owner, language_code: "en" }, "not a link at all");
    expect(h.lastText()).toMatch(/wasn't recognized/);
  });

  test.each([
    ["invite link", "https://t.me/+AbCdEf123", "无法识别"],
    ["not found", "@zzqq_not_exist_987654", "不存在"],
    ["banned", "t.me/qassambrigades", "封禁"],
    ["personal account", "https://t.me/nikolai", "个人账号"],
  ])("%s is rejected with a clear message", async (_label, link, expected) => {
    await h.message(owner, link);
    expect(h.lastText()).toContain(expected);
    expect(await getBotDraft(db, owner.id, Date.now())).toBeUndefined();
  });

  test("a four-character username is a real link, not a support question", async () => {
    await h.message(owner, "@kuai");
    expect(h.tme).toEqual(["/kuai", "/s/kuai"]);
    expect(h.lastButtons().some((b) => b.callback_data?.startsWith("sc:"))).toBe(true);
  });

  describe("with the support relay on", () => {
    const SUPPORT_GROUP = -100777;
    beforeEach(async () => {
      await setBotSettings({ supportGroupId: String(SUPPORT_GROUP) });
    });

    test.each([
      ["a too-short username", "@ab"],
      ["a broken t.me link", "https://t.me/+AbCdEf123"],
      ["a link with a typo", "t.me/ab"],
    ])("%s is relayed, but the buyer is pointed at /submit first", async (_label, text) => {
      await h.message(owner, text);
      const replies = h.calls("sendMessage").filter((c) => c.payload.chat_id === owner.id);
      expect(String(replies[0]?.payload.text)).toContain("/submit");
      expect(String(replies[0]?.payload.text)).toContain("To submit a link");
      // The message still reaches support: nothing is swallowed.
      expect(h.calls("copyMessage")[0]?.payload).toMatchObject({
        chat_id: String(SUPPORT_GROUP),
        from_chat_id: owner.id,
      });
    });

    test("an ordinary question is relayed without the hint", async () => {
      await h.message(owner, "为什么我的频道被拒绝了？");
      const texts = h.calls("sendMessage").map((c) => String(c.payload.text));
      expect(texts.some((text) => text.includes("/submit"))).toBe(false);
      expect(h.calls("copyMessage")).toHaveLength(1);
    });
  });

  test("groups and bots get their own categories", async () => {
    await h.message(owner, "@grammyjs");
    const groupCount = (await listCategories(db)).filter((c) => c.kind === "group").length;
    expect(h.lastButtons().filter((b) => b.callback_data?.startsWith("sc:"))).toHaveLength(
      groupCount,
    );
  });

  test("an entry already awaiting review is not submitted twice", async () => {
    await createSubmission(db, {
      tgUserId: 7,
      username: "pending_one",
      kind: "channel",
      categoryId: 1,
      tagIds: [],
      createdAt: Date.now(),
    });
    await h.message(owner, "@Pending_One");
    expect(h.lastText()).toContain("已在审核中");
    expect(h.tme).toEqual([]);
  });

  test("the daily submission limit is enforced", async () => {
    for (let i = 0; i < 5; i++) {
      await createSubmission(db, {
        tgUserId: owner.id,
        username: `limit_entry_${i}`,
        kind: "channel",
        categoryId: 1,
        tagIds: [],
        createdAt: Date.now() - 1000,
      });
    }
    await h.message(owner, "@one_more_channel");
    expect(h.lastText()).toContain("上限");
    expect(h.tme).toEqual([]);
  });

  test("blacklisted users and usernames are silently ignored", async () => {
    await addToBlacklist(db, { type: "user", value: String(owner.id), reason: null, now: 1 });
    await h.message(owner, "@some_channel");
    await h.message(owner, "/start");
    expect(h.telegram).toEqual([]);

    const other = { ...owner, id: 43 };
    await addToBlacklist(db, { type: "username", value: "Spam_Channel", reason: null, now: 1 });
    await h.message(other, "https://t.me/spam_channel");
    expect(h.telegram).toEqual([]);
    expect(h.tme).toEqual([]);
  });

  test("buttons from an older step are reported as expired", async () => {
    await h.message(owner, "@stale_channel");
    const oldCategory = h.lastButtons().find((b) => b.callback_data?.startsWith("sc:"));
    await press(owner, "sc:");
    // A fresh link restarts the flow, invalidating everything shown before.
    await h.message(owner, "@stale_channel");
    h.reset();
    await h.callback(owner, oldCategory?.callback_data ?? "");
    expect(h.calls("answerCallbackQuery")[0]?.payload.text).toContain("已过期");
  });

  test("/start shows the welcome with a submit button and a way into the app", async () => {
    await h.message(owner, "/start");
    expect(h.lastText()).toContain("欢迎");
    const buttons = h.lastButtons();
    expect(buttons.map((b) => b.callback_data)).toEqual(["submit", "promote", undefined, "lang"]);
    expect(buttons.map((b) => b.web_app?.url)).toContain("https://tgbox.test/app/");
  });

  test("/start points the chat menu button at the app for a regular user", async () => {
    await h.message(owner, "/start");
    const call = h.calls("setChatMenuButton").at(-1);
    expect(call?.payload.menu_button).toMatchObject({
      type: "web_app",
      web_app: { url: "https://tgbox.test/app/" },
    });
  });

  test("an admin gets the menu button pointed at the admin panel instead", async () => {
    await h.message({ ...owner, id: ADMIN.id }, "/start");
    const call = h.calls("setChatMenuButton").at(-1);
    expect(call?.payload.menu_button).toMatchObject({
      web_app: { url: "https://admin.tgbox.test" },
    });
  });

  test("the website's ?start=submit deep link asks for a link and still sets the menu button", async () => {
    // The deep-link branch used to return before the menu button was pushed, so the one person
    // most likely to be new — a visitor arriving from a directory page — never got it.
    await h.message(owner, "/start submit");
    expect(h.lastText()).toContain("链接");
    expect(h.calls("setChatMenuButton").at(-1)?.payload.menu_button).toMatchObject({
      web_app: { url: "https://tgbox.test/app/" },
    });
  });
});
