import { env } from "cloudflare:workers";
import { beforeEach, expect, test } from "vitest";
import {
  createDb,
  insertApprovedEntry,
  listHiddenPostIds,
  listHiddenPosts,
  setEntryHidePosts,
  setPostHidden,
} from "./index.ts";

const db = createDb(env.DB);
const NOW = Date.UTC(2026, 8, 17);

async function entry(username: string) {
  const { id } = await insertApprovedEntry(db, {
    entry: {
      username,
      kind: "channel",
      categoryId: 1,
      title: username,
      description: "",
      listedAt: NOW,
    },
    stats: { members: null, online: null, activityTier: null, statsWrittenAt: NOW },
    tagIds: [],
    now: NOW,
  });
  return id;
}

beforeEach(async () => {
  await env.DB.batch(
    ["hidden_posts", "entries", "entry_stats", "entry_tags", "entries_fts"].map((table) =>
      env.DB.prepare(`DELETE FROM ${table}`),
    ),
  );
});

test("hiding every post of an entry writes only on change", async () => {
  const id = await entry("noisy_channel");
  expect(await setEntryHidePosts(db, { entryId: id, hide: true, now: NOW })).toBe(true);
  expect(await setEntryHidePosts(db, { entryId: id, hide: true, now: NOW + 1 })).toBe(false);
  expect(await setEntryHidePosts(db, { entryId: id, hide: false, now: NOW + 2 })).toBe(true);
});

test("single posts are hidden, listed per entry and paginated for the admin", async () => {
  const noisy = await entry("noisy_channel");
  const other = await entry("other_channel");
  expect(await setPostHidden(db, { entryId: noisy, postId: 12, hidden: true, now: NOW })).toBe(
    true,
  );
  // Already hidden: no second row.
  expect(await setPostHidden(db, { entryId: noisy, postId: 12, hidden: true, now: NOW + 1 })).toBe(
    false,
  );
  await setPostHidden(db, { entryId: noisy, postId: 30, hidden: true, now: NOW + 2 });
  await setPostHidden(db, { entryId: other, postId: 5, hidden: true, now: NOW + 3 });

  expect(await listHiddenPostIds(db, noisy)).toEqual([12, 30]);
  expect(await listHiddenPostIds(db, other)).toEqual([5]);

  const page = await listHiddenPosts(db, { page: 1, pageSize: 2 });
  expect(page.total).toBe(3);
  expect(page.rows.map((row) => [row.username, row.postId])).toEqual([
    ["other_channel", 5],
    ["noisy_channel", 30],
  ]);

  expect(await setPostHidden(db, { entryId: noisy, postId: 12, hidden: false, now: NOW + 4 })).toBe(
    true,
  );
  expect(await setPostHidden(db, { entryId: noisy, postId: 12, hidden: false, now: NOW + 5 })).toBe(
    false,
  );
  expect(await listHiddenPostIds(db, noisy)).toEqual([30]);
});
