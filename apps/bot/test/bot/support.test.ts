import { addBlacklist } from "@tgbox/core";
import { getBlacklistEntry, getSupportThread } from "@tgbox/db";
import { beforeEach, describe, expect, test } from "vitest";
import {
  ADMIN,
  ADMIN_CHAT_ID,
  core,
  db,
  type Harness,
  setBotSettings,
  startHarness,
} from "./harness.ts";

const SUPPORT_GROUP = -100777;
const supportChat = { id: SUPPORT_GROUP, type: "supergroup", title: "Support", is_forum: true };
const user = { id: 555, is_bot: false, first_name: "Ann", username: "ann", language_code: "en" };

let h: Harness;
beforeEach(async () => {
  h = await startHarness();
  await setBotSettings({ supportGroupId: String(SUPPORT_GROUP) });
});

/** The topic id the relay created for `user`. */
async function topicId() {
  const thread = await getSupportThread(db, user.id);
  if (!thread) throw new Error("no support thread");
  return thread.topicId;
}

const inTopic = (topic: number) => ({ message_thread_id: topic });

describe("support relay", () => {
  test("the first message opens one topic and later ones reuse it", async () => {
    await h.message(user, "Hi, my channel was rejected");
    const topic = await topicId();

    expect(h.calls("createForumTopic")).toHaveLength(1);
    expect(h.calls("createForumTopic")[0]?.payload).toMatchObject({
      chat_id: String(SUPPORT_GROUP),
      name: "Ann (555)",
    });
    // A header names the user, then the message itself is copied into the topic.
    const header = h.calls("sendMessage").find((c) => c.payload.message_thread_id === topic);
    expect(String(header?.payload.text)).toContain("@ann");
    expect(String(header?.payload.text)).toContain("555");
    expect(h.calls("copyMessage")[0]?.payload).toMatchObject({
      chat_id: String(SUPPORT_GROUP),
      from_chat_id: user.id,
      message_thread_id: topic,
    });
    expect(h.lastText()).toContain("Sent to support");

    const before = await getSupportThread(db, user.id);
    h.reset();
    await h.message(user, "Any update?");
    expect(h.calls("createForumTopic")).toEqual([]);
    expect(h.calls("copyMessage")).toHaveLength(1);
    // Only the first message of a session is acknowledged.
    expect(h.calls("sendMessage")).toEqual([]);
    // No D1 write: the thread row is refreshed at most once an hour.
    expect(await getSupportThread(db, user.id)).toEqual(before);
  });

  test("photos and stickers are relayed too", async () => {
    await h.message(user, "first");
    h.reset();
    await h.update({
      message: {
        message_id: 9001,
        date: 0,
        chat: { id: user.id, type: "private" },
        from: user,
        photo: [{ file_id: "abc", file_unique_id: "u", width: 10, height: 10 }],
      },
    });
    expect(h.calls("copyMessage")[0]?.payload).toMatchObject({ message_id: 9001 });
  });

  test("support staff replies in the topic reach the user", async () => {
    await h.message(user, "Hi");
    const topic = await topicId();
    h.reset();

    await h.message(ADMIN, "Send us a screenshot", supportChat, inTopic(topic));
    expect(h.calls("copyMessage")[0]?.payload).toMatchObject({
      chat_id: user.id,
      from_chat_id: SUPPORT_GROUP,
    });
  });

  test("the bot's own messages and topic service messages are not bounced back", async () => {
    await h.message(user, "Hi");
    const topic = await topicId();
    h.reset();

    const botAccount = { id: 123456, is_bot: true, first_name: "TGbox" };
    await h.message(botAccount, "header", supportChat, inTopic(topic));
    await h.update({
      message: {
        message_id: 9100,
        date: 0,
        chat: supportChat,
        from: ADMIN,
        ...inTopic(topic),
        forum_topic_created: { name: "Ann (555)", icon_color: 0 },
      },
    });
    expect(h.calls("copyMessage")).toEqual([]);
  });

  test("/ban in a topic blacklists that user instead of asking for a target", async () => {
    await h.message(user, "buy followers here");
    const topic = await topicId();
    h.reset();

    await h.message(ADMIN, "/ban 广告", supportChat, inTopic(topic));
    expect(await getBlacklistEntry(db, "user", String(user.id))).toMatchObject({ reason: "广告" });
    expect(h.lastText()).toContain("已拉黑用户 555");
    expect(h.calls("sendMessage")[0]?.payload).toMatchObject({ message_thread_id: topic });

    // Blacklisted users are ignored from then on.
    h.reset();
    await h.message(user, "let me in");
    expect(h.telegram).toEqual([]);
  });

  test("/done closes the topic and the next message from the user reopens it", async () => {
    await h.message(user, "Hi");
    const topic = await topicId();
    h.reset();

    await h.message(ADMIN, "/done", supportChat, inTopic(topic));
    expect(h.lastText()).toContain("已结束本次会话");
    expect(h.calls("closeForumTopic")[0]?.payload).toMatchObject({
      chat_id: SUPPORT_GROUP,
      message_thread_id: topic,
    });

    h.reset();
    h.failOnce("copyMessage", "Bad Request: TOPIC_CLOSED");
    await h.message(user, "One more thing");
    expect(h.calls("reopenForumTopic")[0]?.payload).toMatchObject({
      chat_id: String(SUPPORT_GROUP),
      message_thread_id: topic,
    });
    // Same topic, no second one, and the retried copy went through.
    expect(h.calls("createForumTopic")).toEqual([]);
    expect(h.calls("copyMessage")).toHaveLength(2);
    expect(await topicId()).toBe(topic);
  });

  test("a blacklisted user is ignored before any topic is created", async () => {
    await addBlacklist(core, {
      type: "user",
      value: String(user.id),
      reason: null,
      actor: "system",
    });
    await h.message(user, "Hello?");
    expect(h.telegram).toEqual([]);
    expect(await getSupportThread(db, user.id)).toBeUndefined();
  });

  test("a group that isn't a forum is reported to the reviewers once", async () => {
    h.failOnce("createForumTopic", "Bad Request: the chat is not a forum");
    await h.message(user, "Hello?");
    const notice = h
      .calls("sendMessage")
      .find((c) => String(c.payload.text).includes("客服转发失败"));
    expect(notice?.payload.chat_id).toBe(String(ADMIN_CHAT_ID));
    expect(String(notice?.payload.text)).toContain("not a forum");
    expect(h.lastText()).toContain("Support can't take messages right now");
    expect(await getSupportThread(db, user.id)).toBeUndefined();
  });

  test("/support asks the user to just type while the relay is on", async () => {
    await h.message(user, "/support");
    expect(h.lastText()).toContain("Just send your question here");

    await setBotSettings({ supportGroupId: null, supportUsername: "help_desk" });
    await h.message(user, "/support");
    expect(h.lastText()).toContain("@help_desk");
  });

  test("without a support group a stray message still gets the 'send me a link' reply", async () => {
    await setBotSettings({ supportGroupId: null });
    await h.message(user, "hello there");
    expect(h.lastText()).toContain("That link wasn't recognized");
    expect(h.calls("createForumTopic")).toEqual([]);
  });

  test("the relay switch turns it off without clearing the group", async () => {
    await setBotSettings({ supportGroupId: String(SUPPORT_GROUP), supportEnabled: false });
    await h.message(user, "hello there");
    expect(h.calls("createForumTopic")).toEqual([]);
    expect(h.lastText()).toContain("That link wasn't recognized");
  });

  test("links still start a submission while the relay is on", async () => {
    await h.message(user, "https://t.me/sample_channel");
    expect(h.calls("createForumTopic")).toEqual([]);
    expect(h.lastText()).toContain("Choose a category");
  });

  test("admin commands outside a support topic keep working in the support group", async () => {
    await h.message(ADMIN, "/ban 12345 spam", supportChat);
    expect(await getBlacklistEntry(db, "user", "12345")).toMatchObject({ reason: "spam" });
  });
});
