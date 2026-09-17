import { getSubmission } from "@tgbox/db";
import { beforeEach, describe, expect, test } from "vitest";
import { ADMIN, ADMIN_2, db, type Harness, setBotSettings, startHarness } from "./harness.ts";

const owner = { id: 42, is_bot: false, first_name: "Owner", language_code: "zh-hans" };

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

const reviewCopies = (h: Harness) =>
  h.calls("sendMessage").filter((c) => String(c.payload.text).includes("新提交"));

describe("review messages sent to every admin", () => {
  test("each admin gets a private copy and the first decision wins on every copy", async () => {
    await setBotSettings({ reviewMode: "admins", reviewChatId: "-100777", extraAdminIds: ["902"] });
    await submitThroughFlow();

    const copies = reviewCopies(h);
    expect(copies.map((c) => String(c.payload.chat_id))).toEqual(["900", "901", "902"]);
    const approve = JSON.stringify(copies[0]?.payload.reply_markup).match(/ra:(\d+)/);
    const id = Number(approve?.[1]);
    // Private copies are not tracked as the one admin message.
    expect(await getSubmission(db, id)).toMatchObject({ status: "pending", adminMessageId: null });

    h.reset();
    const copy = (chatId: number) => ({
      message_id: 10 + chatId,
      date: 0,
      chat: { id: chatId, type: "private" },
      text: "📥 新提交",
    });
    await h.callback(ADMIN, `ra:${id}`, copy(ADMIN.id));
    await h.callback(ADMIN_2, `rj:${id}`, copy(ADMIN_2.id));

    expect(await getSubmission(db, id)).toMatchObject({ status: "approved", reviewerId: ADMIN.id });
    expect(h.calls("editMessageText").map((c) => c.payload.chat_id)).toEqual([ADMIN.id]);
    expect(h.calls("answerCallbackQuery").map((c) => c.payload.text)).toContain("已被处理。");
    // The stale copy only loses its own buttons.
    expect(h.calls("editMessageReplyMarkup").map((c) => c.payload)).toEqual([
      { chat_id: ADMIN_2.id, message_id: 10 + ADMIN_2.id },
    ]);
  });

  test("chat mode keeps a single review message and records it", async () => {
    await setBotSettings({ reviewChatId: "-100777" });
    await submitThroughFlow();
    const [message] = reviewCopies(h);
    expect(reviewCopies(h)).toHaveLength(1);
    const id = Number(JSON.stringify(message?.payload.reply_markup).match(/ra:(\d+)/)?.[1]);
    expect((await getSubmission(db, id))?.adminMessageId).toBeTypeOf("number");
  });
});
