import {
  applyForFriendLink,
  approveFriendLink,
  getSettings,
  rejectFriendLink,
  setFriendLinks,
  updateSettings,
} from "@tgbox/core";
import { getSiteState, setUserLocale } from "@tgbox/db";
import { MAX_FRIEND_LINKS, settingsDefaults } from "@tgbox/shared";
import { describe, expect, test } from "vitest";
import { actor, auditRows, db, NOW, setup } from "./fake.ts";

const application = {
  tgUserId: 77,
  url: "https://www.friend.example/",
  name: "Friend",
  description: "A friendly site",
};
const link = (n: number) => ({
  name: `Site ${n}`,
  url: `https://site${n}.example/`,
  descZh: "",
  descEn: "",
});

describe("friend links", () => {
  test("an application records whether the applicant's page links back", async () => {
    const { ctx, websites } = await setup({ SITE_URL: "https://tgbox.cc" });
    websites.set("www.friend.example", '<footer><a href="https://tgbox.cc/">TGbox</a></footer>');
    const applied = await applyForFriendLink(ctx, application);
    expect(applied).toMatchObject({ ok: true, request: { backlink: true, status: "pending" } });

    const other = await applyForFriendLink(ctx, {
      ...application,
      tgUserId: 78,
      url: "https://gone.example/",
    });
    expect(other).toMatchObject({ ok: true, request: { backlink: false } });
  });

  test("one open application per applicant, and none for a site already listed", async () => {
    const { ctx } = await setup({ SITE_URL: "https://tgbox.cc" });
    await applyForFriendLink(ctx, application);
    expect(await applyForFriendLink(ctx, { ...application, url: "https://b.example/" })).toEqual({
      ok: false,
      error: "pending",
    });
    await setFriendLinks(ctx, {
      links: [{ ...link(1), url: "https://friend.example" }],
      actor,
    });
    // www. or not, it is the same site.
    expect(await applyForFriendLink(ctx, { ...application, tgUserId: 79 })).toEqual({
      ok: false,
      error: "listed",
    });
  });

  test("approval appends the site, rebuilds, audits, tells the applicant, once", async () => {
    const { ctx, dispatches, telegram } = await setup({
      SITE_URL: "https://tgbox.cc",
      BOT_TOKEN: "123:abc",
    });
    const applied = await applyForFriendLink(ctx, application);
    if (!applied.ok) throw new Error(applied.error);
    const approved = await approveFriendLink(ctx, { id: applied.request.id, actor });
    expect(approved).toMatchObject({ ok: true, request: { status: "approved" } });
    expect((await getSettings(ctx)).site.friendLinks).toEqual([
      {
        name: "Friend",
        url: "https://www.friend.example/",
        descZh: "A friendly site",
        descEn: "A friendly site",
      },
    ]);
    expect(await getSiteState(db, "dirty_since")).toBe(String(NOW));
    expect(dispatches.length).toBe(1);
    // No stored bot language: both.
    expect(telegram).toEqual([
      {
        method: "sendMessage",
        body: {
          chat_id: 77,
          text: '🎉 你的友链申请「Friend」已通过，网站几分钟后更新。\n\n🎉 Your link application "Friend" was approved. The site updates in a few minutes.',
        },
      },
    ]);
    expect(await approveFriendLink(ctx, { id: applied.request.id, actor })).toBeNull();
    expect(await rejectFriendLink(ctx, { id: applied.request.id, actor })).toBeNull();
    expect(await auditRows()).toContainEqual({
      actor,
      action: "friendLink.approve",
      target: `friend-link:${applied.request.id}`,
    });
  });

  test("an applicant who chose Traditional in the bot is told in Traditional only", async () => {
    const { ctx, telegram } = await setup({ SITE_URL: "https://tgbox.cc", BOT_TOKEN: "123:abc" });
    await setUserLocale(db, application.tgUserId, "zh-hant", NOW);
    const applied = await applyForFriendLink(ctx, application);
    if (!applied.ok) throw new Error(applied.error);
    await rejectFriendLink(ctx, { id: applied.request.id, actor });
    expect(telegram.map((call) => call.body)).toEqual([
      { chat_id: 77, text: "抱歉，你的友鏈申請「Friend」未通過。" },
    ]);
  });

  test("a full list leaves the application pending", async () => {
    const { ctx } = await setup({ SITE_URL: "https://tgbox.cc" });
    await setFriendLinks(ctx, {
      links: Array.from({ length: MAX_FRIEND_LINKS }, (_, n) => link(n)),
      actor,
    });
    const applied = await applyForFriendLink(ctx, application);
    if (!applied.ok) throw new Error(applied.error);
    expect(await approveFriendLink(ctx, { id: applied.request.id, actor })).toEqual({
      ok: false,
      error: "full",
    });
    expect(await rejectFriendLink(ctx, { id: applied.request.id, actor })).toMatchObject({
      status: "rejected",
    });
  });

  test("saving the other site settings keeps the friend links", async () => {
    const { ctx } = await setup();
    await setFriendLinks(ctx, { links: [link(1)], actor });
    const { friendLinks: _, ...rest } = settingsDefaults.site;
    await updateSettings(ctx, { key: "site", value: { ...rest, showAdSlots: true }, actor });
    const { site } = await getSettings(ctx);
    expect(site.showAdSlots).toBe(true);
    expect(site.friendLinks).toEqual([link(1)]);
  });
});
