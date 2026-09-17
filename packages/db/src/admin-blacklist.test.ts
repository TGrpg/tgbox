import { env } from "cloudflare:workers";
import { beforeEach, expect, test } from "vitest";
import { addToBlacklist, createDb, listBlacklist } from "./index.ts";

const db = createDb(env.DB);
const NOW = Date.UTC(2026, 8, 17);

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM blacklist").run();
});

test("the blacklist is read one bounded page at a time, newest first", async () => {
  for (const index of [0, 1, 2]) {
    await addToBlacklist(db, {
      type: "username",
      value: `spammer${index}`,
      reason: null,
      now: NOW + index,
    });
  }

  const first = await listBlacklist(db, { page: 1, pageSize: 2 });
  expect(first.total).toBe(3);
  expect(first.rows.map((row) => row.value)).toEqual(["spammer2", "spammer1"]);

  const second = await listBlacklist(db, { page: 2, pageSize: 2 });
  expect(second.rows.map((row) => row.value)).toEqual(["spammer0"]);

  // An unbounded page size is clamped, never passed through to D1.
  expect((await listBlacklist(db, { page: 1, pageSize: 10_000 })).rows).toHaveLength(3);
});
