import { env } from "cloudflare:workers";
import { getSettings, setFeatured, setFriendLinks, updateSettings } from "@tgbox/core";
import { getSiteState, upsertSetting } from "@tgbox/db";
import { settingsDefaults } from "@tgbox/shared";
import { expect, test } from "vitest";
import { actor, auditRows, db, NOW, setup } from "./fake.ts";

const first = { name: "频道", url: "https://t.me/first", descZh: "每日更新", descEn: "Daily" };
const second = { name: "Second", url: "https://example.com/", descZh: "", descEn: "" };
// What a save may touch: the settings rows, the audit log and the dirty flag.
const writes = () =>
  env.DB.prepare(
    `SELECT (SELECT group_concat(key || ':' || updated_at || ':' || value) FROM settings) AS settings,
       (SELECT count(*) FROM audit_log) AS audits,
       (SELECT group_concat(key || ':' || value) FROM site_state) AS state`,
  ).first();

test("old site settings keep their values and default to no featured items", async () => {
  const { ctx } = await setup();
  await upsertSetting(db, "site", JSON.stringify({ showAdSlots: true, friendLinks: [first] }), NOW);
  expect((await getSettings(ctx)).site).toEqual({
    ...settingsDefaults.site,
    showAdSlots: true,
    friendLinks: [first],
    featured: [],
  });
});

test("featured saves retain order, audit the actor and rebuild only on change", async () => {
  const { ctx, dispatches } = await setup();
  const beforeEmpty = await writes();
  expect(await setFeatured(ctx, { featured: [], actor })).toEqual({ changed: false });
  expect(await writes()).toEqual(beforeEmpty);

  expect(await setFeatured(ctx, { featured: [first, second], actor })).toEqual({ changed: true });
  expect((await getSettings(ctx)).site.featured).toEqual([first, second]);
  expect(await getSiteState(db, "dirty_since")).toBe(String(NOW));
  expect(dispatches).toHaveLength(1);
  expect(await auditRows()).toEqual([
    { actor, action: "settings.update", target: "settings:site" },
  ]);

  const beforeSame = await writes();
  expect(await setFeatured(ctx, { featured: [first, second], actor })).toEqual({ changed: false });
  expect(await writes()).toEqual(beforeSame);
  expect(await auditRows()).toHaveLength(1);
  expect(dispatches).toHaveLength(1);

  await setFeatured(ctx, { featured: [second, first], actor });
  expect((await getSettings(ctx)).site.featured).toEqual([second, first]);
  await setFeatured(ctx, { featured: [second], actor });
  expect((await getSettings(ctx)).site.featured).toEqual([second]);
  await setFeatured(ctx, { featured: [], actor });
  expect((await getSettings(ctx)).site.featured).toEqual([]);
});

test("featured, friend links and other site settings do not overwrite each other", async () => {
  const { ctx } = await setup();
  await setFriendLinks(ctx, { links: [second], actor });
  await setFeatured(ctx, { featured: [first], actor });
  await updateSettings(ctx, {
    key: "site",
    value: { ...settingsDefaults.site, showAdSlots: true },
    actor,
  });
  expect((await getSettings(ctx)).site).toMatchObject({
    friendLinks: [second],
    featured: [first],
    showAdSlots: true,
  });
  await setFriendLinks(ctx, { links: [], actor });
  expect((await getSettings(ctx)).site.featured).toEqual([first]);
});

test("invalid featured input writes nothing", async () => {
  const { ctx } = await setup();
  const before = await writes();
  for (const featured of [[{ ...first, url: "http://example.com" }], Array(21).fill(first)]) {
    await expect(setFeatured(ctx, { featured, actor })).rejects.toThrow();
  }
  expect(await writes()).toEqual(before);
  expect(await auditRows()).toEqual([]);
});
