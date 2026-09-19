import { getSettings } from "@tgbox/core";
import { createSubmission, listBotChats } from "@tgbox/db";
import { beforeEach, describe, expect, test } from "vitest";
import { ADMIN, core, db, type Harness, setBotSettings, startHarness } from "./harness.ts";

const owner = { id: 42, is_bot: false, first_name: "Owner", language_code: "zh-hans" };
const group = { id: -100888, type: "supergroup", title: "Review Room" };
const botUser = { id: 123456, is_bot: true, first_name: "TGbox", username: "tgboxccbot" };

let h: Harness;
beforeEach(async () => {
  h = await startHarness();
});

async function submitThroughFlow() {
  await h.message(owner, "https://t.me/sample_channel");
  for (const prefix of ["sc:", "sd:", "so:"]) {
    const button = h.lastButtons().find((b) => b.callback_data?.startsWith(prefix));
    await h.callback(owner, button?.callback_data ?? "");
  }
}

describe("settings-driven bot", () => {
  test("new submissions go to the review chat from the settings instead of ADMIN_CHAT_ID", async () => {
    await setBotSettings({ reviewChatId: "-100777" });
    await submitThroughFlow();
    const notices = h
      .calls("sendMessage")
      .filter((c) => c.payload.text?.toString().includes("新提交"));
    expect(notices.map((c) => String(c.payload.chat_id))).toEqual(["-100777"]);
  });

  test("closed submissions get a friendly reply without looking the link up", async () => {
    await setBotSettings({ submissionsOpen: false });
    await h.message(owner, "https://t.me/sample_channel");
    expect(h.lastText()).toContain("收录暂时关闭");
    await h.message(owner, "/submit");
    expect(h.lastText()).toContain("收录暂时关闭");
    expect(h.tme).toEqual([]);
  });

  test("the daily limit comes from the settings", async () => {
    await setBotSettings({ submitDailyLimit: 1 });
    await createSubmission(db, {
      tgUserId: owner.id,
      username: "first_today",
      kind: "channel",
      categoryId: 1,
      tagIds: [],
      createdAt: Date.now() - 1000,
    });
    await h.message(owner, "@second_today");
    expect(h.lastText()).toContain("上限（1 次）");
  });

  test("/start uses the custom welcome and /support the configured username", async () => {
    await h.message(owner, "/support");
    expect(h.lastText()).toContain("暂未设置客服");
    await setBotSettings({ welcome: { zh: "自定义欢迎语", en: "" }, supportUsername: "help_desk" });
    await h.message(owner, "/start");
    expect(h.lastText()).toBe("自定义欢迎语");
    await h.message({ ...owner, language_code: "en" }, "/start");
    expect(h.lastText()).toContain("Welcome to the TGbox");
    await h.message(owner, "/support");
    expect(h.lastText()).toContain("@help_desk");
  });

  test("my_chat_member updates are recorded for groups and channels only", async () => {
    const memberUpdate = (chat: Record<string, unknown>, status: string) => ({
      my_chat_member: {
        chat,
        from: ADMIN,
        date: 0,
        old_chat_member: { user: botUser, status: "left" },
        new_chat_member: { user: botUser, status },
      },
    });
    await h.update(memberUpdate(group, "member"));
    await h.update(
      memberUpdate({ ...group, id: -100999, type: "channel", username: "news" }, "administrator"),
    );
    await h.update(memberUpdate({ id: owner.id, type: "private", first_name: "Owner" }, "kicked"));
    await h.update(memberUpdate(group, "administrator"));

    const { rows: chats } = await listBotChats(db, { page: 1 });
    expect(chats.map(({ updatedAt: _t, ...chat }) => chat)).toEqual(
      expect.arrayContaining([
        {
          chatId: "-100888",
          type: "supergroup",
          title: "Review Room",
          username: null,
          status: "administrator",
        },
        {
          chatId: "-100999",
          type: "channel",
          title: "Review Room",
          username: "news",
          status: "administrator",
        },
      ]),
    );
    expect(chats).toHaveLength(2);
  });

  test("/setreview in a group makes it the review chat, for super and settings admins only", async () => {
    const stranger = { id: 555, is_bot: false, first_name: "Eve" };
    await h.message(stranger, "/setreview", group);
    expect((await getSettings(core)).bot.reviewChatId).toBeNull();
    expect(h.telegram).toEqual([]);

    await h.message(ADMIN, "/setreview", group);
    expect((await getSettings(core)).bot.reviewChatId).toBe("-100888");
    expect(h.lastText()).toContain("审核群");

    await setBotSettings({ extraAdminIds: ["555"] });
    await h.message(stranger, "/setreview", { ...group, id: -100111 });
    expect((await getSettings(core)).bot).toMatchObject({
      reviewChatId: "-100111",
      extraAdminIds: ["555"],
    });
  });

  test("an approved submission is announced in the publish channel with its site link", async () => {
    await setBotSettings({ publishChannelId: "-100999" });
    const id = await createSubmission(db, {
      tgUserId: owner.id,
      username: "publish_me",
      kind: "channel",
      categoryId: 1,
      tagIds: [],
      fetchedTitle: "Publish Me",
      createdAt: Date.now(),
    });
    await h.callback(ADMIN, `ra:${id}`, {
      message_id: 1,
      date: 0,
      chat: { id: -100500, type: "supergroup" },
      text: "📥",
    });
    const post = h.calls("sendMessage").find((c) => String(c.payload.chat_id) === "-100999");
    expect(post?.payload.text).toContain("@publish_me");
    expect(post?.payload.text).toContain("https://tgbox.test/detail/publish_me/");
  });

  test("deep links /start promote, /start submit and /start support open those flows", async () => {
    await h.message(owner, "/start submit");
    expect(h.lastText()).toContain("请发送要提交的频道");

    await h.message(owner, "/start support");
    expect(h.lastText()).toContain("暂未设置客服");

    await h.message(owner, "/start promote");
    const products = h.lastButtons().filter((b) => b.callback_data?.startsWith("pk:"));
    expect(products.length).toBeGreaterThan(0);
    expect(h.calls("sendMessage").some((c) => String(c.payload.text).includes("欢迎"))).toBe(false);
  });
});
