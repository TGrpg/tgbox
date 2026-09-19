import { getSettings } from "@tgbox/core";
import { getBotDraft } from "@tgbox/db";
import { beforeEach, describe, expect, test } from "vitest";
import { ADMIN, ADMIN_CHAT_ID, core, db, type Harness, startHarness } from "./harness.ts";

const owner = {
  id: 5151,
  is_bot: false,
  first_name: "Owner",
  username: "site_owner",
  language_code: "en",
};
const reviewMessage = {
  message_id: 77,
  date: 0,
  chat: { id: ADMIN_CHAT_ID, type: "supergroup", title: "Admins" },
  text: "🤝 友链申请待审核",
};

let h: Harness;
beforeEach(async () => {
  h = await startHarness();
});

/** Walks the three questions; returns the review message the admins got. */
async function apply(url = "https://friend.example/") {
  await h.message(owner, "/start links");
  await h.message(owner, url);
  await h.message(owner, "Friend Site");
  await h.message(owner, "Tools and guides for Telegram");
  return h
    .calls("sendMessage")
    .find((call) => String(call.payload.chat_id) === String(ADMIN_CHAT_ID));
}

describe("friend link applications", () => {
  test("the deep link asks three questions and sends the admins a review with the backlink check", async () => {
    h.websites.set("friend.example", '<a href="https://tgbox.test/">TGbox</a>');
    const review = await apply();
    expect(review?.payload.text).toContain("Friend Site");
    expect(review?.payload.text).toContain("https://friend.example/");
    expect(review?.payload.text).toContain("✅ 首页已有本站链接");
    expect(JSON.stringify(review?.payload.reply_markup)).toMatch(/"fa:\d+".*"fj:\d+"/);
    expect(await getBotDraft(db, owner.id, Date.now())).toBeUndefined();
    const replies = h
      .calls("sendMessage")
      .filter((call) => call.payload.chat_id === owner.id)
      .map((call) => String(call.payload.text));
    expect(replies.at(-1)).toBe("✅ Application sent. We'll message you with the result.");
  });

  test("a bad address is asked for again, and a missing backlink is flagged", async () => {
    await h.message(owner, "/start links");
    await h.message(owner, "friend.example");
    expect(h.lastText()).toContain("isn't valid");
    await h.message(owner, "https://gone.example/");
    await h.message(owner, "Gone");
    await h.message(owner, "Nothing here");
    expect(h.lastText()).toContain("❌ 首页未找到本站链接");
  });

  test("approval adds the link to the site, tells the applicant and closes the review", async () => {
    const review = await apply();
    const approve = JSON.stringify(review?.payload.reply_markup).match(/fa:\d+/)?.[0] ?? "";
    h.reset();
    await h.callback(ADMIN, approve, reviewMessage);
    expect((await getSettings(core)).site.friendLinks).toEqual([
      {
        name: "Friend Site",
        url: "https://friend.example/",
        descZh: "Tools and guides for Telegram",
        descEn: "Tools and guides for Telegram",
      },
    ]);
    const told = h.calls("sendMessage").find((call) => call.payload.chat_id === owner.id);
    expect(String(told?.payload.text)).toContain('"Friend Site" was approved');
    expect(String(h.calls("editMessageText")[0]?.payload.text)).toContain(
      "✅ 已通过（@alice_admin）",
    );

    // A second tap on another copy finds it handled.
    h.reset();
    await h.callback(ADMIN, approve, reviewMessage);
    expect(h.calls("answerCallbackQuery")[0]?.payload.show_alert).toBe(true);
  });

  test("only admins can review", async () => {
    const review = await apply();
    const reject = JSON.stringify(review?.payload.reply_markup).match(/fj:\d+/)?.[0] ?? "";
    h.reset();
    await h.callback(owner, reject, reviewMessage);
    expect(h.calls("editMessageText")).toEqual([]);
    await h.callback(ADMIN, reject, reviewMessage);
    expect(String(h.calls("editMessageText")[0]?.payload.text)).toContain("❌ 已拒绝");
  });

  test("one open application at a time", async () => {
    await apply();
    await apply("https://other.example/");
    expect(h.lastText()).toContain("already have a link application");
  });
});
