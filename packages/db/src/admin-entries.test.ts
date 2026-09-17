import { env } from "cloudflare:workers";
import { beforeEach, expect, test } from "vitest";
import {
  createDb,
  insertApprovedEntry,
  listTagIdsForEntries,
  listTags,
  syncTaxonomy,
} from "./index.ts";

const db = createDb(env.DB);
const NOW = Date.UTC(2026, 8, 17);

beforeEach(async () => {
  await env.DB.batch(
    ["entries", "entry_stats", "entry_tags", "entries_fts"].map((table) =>
      env.DB.prepare(`DELETE FROM ${table}`),
    ),
  );
  await syncTaxonomy(db);
});

async function listed(username: string, tagIds: number[]) {
  const { id } = await insertApprovedEntry(db, {
    entry: { username, kind: "channel", categoryId: 1, title: username, listedAt: NOW },
    stats: { members: 1, online: null, activityTier: null, statsWrittenAt: NOW },
    tagIds,
    now: NOW,
  });
  return id;
}

test("tag ids are grouped per requested entry", async () => {
  const [a, b, c] = (await listTags(db)).map((tag) => tag.id);
  if (a === undefined || b === undefined || c === undefined) throw new Error("no tags");
  const first = await listed("first", [b, a]);
  const second = await listed("second", [c]);
  const untagged = await listed("untagged", []);
  await listed("other_page", [a]);

  const tags = await listTagIdsForEntries(db, [first, second, untagged]);
  expect([...tags.entries()]).toEqual([
    [first, [a, b].sort((x, y) => x - y)],
    [second, [c]],
  ]);
  expect((await listTagIdsForEntries(db, [])).size).toBe(0);
});
