import { createBroadcast, emailActor } from "@tgbox/core";
import { getBotUserDetail, getBroadcast } from "@tgbox/db";
import { beforeEach, describe, expect, test } from "vitest";
import { core, db, type Harness, startHarness } from "./harness.ts";

const ann = { id: 555, is_bot: false, first_name: "Ann", username: "ann", language_code: "en" };

let h: Harness;
beforeEach(async () => {
  h = await startHarness();
});

describe("user list", () => {
  test("a private chat records its sender; a group message doesn't", async () => {
    await h.message(ann, "/help");
    expect(await getBotUserDetail(db, ann.id)).toMatchObject({
      firstName: "Ann",
      username: "ann",
      languageCode: "en",
    });
    const bob = { id: 556, is_bot: false, first_name: "Bob" };
    await h.message(bob, "hello", { id: -100123, type: "supergroup", title: "Some group" });
    expect(await getBotUserDetail(db, bob.id)).toBeUndefined();
  });

  test("a renamed user is updated", async () => {
    await h.message(ann, "/help");
    await h.message({ ...ann, username: "ann_new" }, "/help");
    expect(await getBotUserDetail(db, ann.id)).toMatchObject({ username: "ann_new" });
  });
});

describe("broadcast cron", () => {
  test("the 5-minute tick keeps a broadcast going after the admin left the page", async () => {
    await h.message(ann, "/help");
    await h.message({ ...ann, id: 557, username: "cat" }, "/help");
    const ctx = { ...core, config: { ...core.config, BOT_TOKEN: "1:x" } };
    const created = await createBroadcast(ctx, {
      message: {
        text: "新功能上线",
        format: "plain",
        media: null,
        buttons: [],
        buttonsPerRow: 1,
        silent: false,
        protect: false,
        noPreview: false,
      },
      audience: "all",
      actor: emailActor("admin@example.com"),
    });
    if (!created.ok) throw new Error(created.error);
    h.reset();
    await h.scheduled(Date.now(), "*/5 * * * *");
    expect(h.calls("sendMessage").map((call) => call.payload.chat_id)).toEqual([555, 557]);
    expect(await getBroadcast(db, created.broadcast.id)).toMatchObject({ status: "done", sent: 2 });
  });
});
