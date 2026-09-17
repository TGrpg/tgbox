import {
  createSubmission,
  getEntryByUsername,
  getSiteState,
  getSubmission,
  listTags,
} from "@tgbox/db";
import { beforeEach, describe, expect, test } from "vitest";
import { ADMIN, ADMIN_2, ADMIN_CHAT_ID, db, type Harness, startHarness } from "./harness.ts";

const submitter = 4242;
const adminMessage = {
  message_id: 77,
  date: 0,
  chat: { id: ADMIN_CHAT_ID, type: "supergroup", title: "Admins" },
  text: "📥 新提交",
};

let h: Harness;
let submissionId: number;

beforeEach(async () => {
  h = await startHarness();
  const tagIds = (await listTags(db)).slice(0, 2).map((tag) => tag.id);
  submissionId =
    (await createSubmission(db, {
      tgUserId: submitter,
      username: "review_me",
      kind: "channel",
      categoryId: 1,
      tagIds,
      fetchedTitle: "Review Me",
      fetchedMembers: 10,
      createdAt: Date.now(),
    })) ?? 0;
});

describe("reviewing submissions", () => {
  test("an approval is completed even when Telegram rejects the callback answer", async () => {
    h.rejectTelegram();
    const response = await h.callback(ADMIN, `ra:${submissionId}`, adminMessage);

    expect(response.status).toBe(200);
    expect(await getEntryByUsername(db, "review_me")).toMatchObject({ status: "approved" });
    expect(await getSiteState(db, "dirty_since")).toBeDefined();
    expect(h.calls("sendMessage").map((c) => c.payload.chat_id)).toEqual([submitter]);
  });

  test("approving lists the entry, marks the site dirty, dispatches once and notifies the submitter", async () => {
    await h.callback(ADMIN, `ra:${submissionId}`, adminMessage);

    expect(await getSubmission(db, submissionId)).toMatchObject({
      status: "approved",
      reviewerId: ADMIN.id,
    });
    const entry = await getEntryByUsername(db, "review_me");
    expect(entry).toMatchObject({
      status: "approved",
      kind: "channel",
      title: "Telegram News",
      categoryId: 1,
    });
    expect(entry?.tgCreatedAt).toBeTypeOf("number");
    expect(await getSiteState(db, "dirty_since")).toBeDefined();

    expect(h.dispatches).toEqual([
      {
        url: "https://api.github.com/repos/owner/tgbox/dispatches",
        body: JSON.stringify({ event_type: "content-changed" }),
      },
    ]);
    const edit = h.calls("editMessageText")[0];
    expect(edit?.payload.text).toContain("已通过（@alice_admin）");
    const notice = h.calls("sendMessage").find((c) => c.payload.chat_id === submitter);
    expect(notice?.payload.text).toContain("review_me");

    // The listed entry is now searchable inline.
    h.reset();
    await h.inline(ADMIN, "Telegram News");
    expect(h.calls("answerInlineQuery")[0]?.payload.results).toHaveLength(1);
  });

  test("a second approval (another admin, same moment) only sees 'already handled'", async () => {
    await Promise.all([
      h.callback(ADMIN, `ra:${submissionId}`, adminMessage),
      h.callback(ADMIN_2, `ra:${submissionId}`, adminMessage),
    ]);
    const answers = h.calls("answerCallbackQuery").map((c) => c.payload.text);
    expect(answers.filter((text) => text === "已处理。")).toHaveLength(1);
    expect(h.dispatches).toHaveLength(1);
    expect(h.calls("sendMessage").filter((c) => c.payload.chat_id === submitter)).toHaveLength(1);
  });

  test("a further change while the site is already dirty does not dispatch again", async () => {
    await h.callback(ADMIN, `ra:${submissionId}`, adminMessage);
    await h.message(ADMIN, "/hide @review_me");
    expect(h.dispatches).toHaveLength(1);
  });

  test("non-admins cannot review", async () => {
    const stranger = { id: 1, is_bot: false, first_name: "Eve" };
    await h.callback(stranger, `ra:${submissionId}`, adminMessage);
    await h.callback(stranger, `rr:${submissionId}:content`, adminMessage);
    expect(h.calls("answerCallbackQuery").map((c) => c.payload.text)).toEqual([
      "没有权限。",
      "没有权限。",
    ]);
    expect(await getSubmission(db, submissionId)).toMatchObject({ status: "pending" });
    expect(await getEntryByUsername(db, "review_me")).toBeUndefined();
  });

  test("rejecting asks for a reason, records it and tells the submitter", async () => {
    await h.callback(ADMIN, `rj:${submissionId}`, adminMessage);
    const reasonButtons = h.calls("editMessageReplyMarkup")[0]?.payload.reply_markup;
    expect(JSON.stringify(reasonButtons)).toContain(`rr:${submissionId}:fake_subs`);

    await h.callback(ADMIN, `rr:${submissionId}:fake_subs`, adminMessage);
    expect(await getSubmission(db, submissionId)).toMatchObject({
      status: "rejected",
      rejectReason: "fake_subs",
    });
    expect(h.calls("editMessageText")[0]?.payload.text).toContain("已拒绝（@alice_admin）：僵尸粉");
    const notice = h.calls("sendMessage").find((c) => c.payload.chat_id === submitter);
    expect(notice?.payload.text).toContain("僵尸粉");
    expect(notice?.payload.text).toContain("Fake subscribers");
    expect(h.dispatches).toEqual([]);
    expect(await getEntryByUsername(db, "review_me")).toBeUndefined();
  });
});
