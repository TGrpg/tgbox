import { env } from "cloudflare:workers";
import { expect, test, vi } from "vitest";
import { createDb, entries, getEntryByUsername, setEntryStartPayload } from "./index.ts";

test("entries alone persist nullable bot payloads and enforce Telegram grammar", async () => {
  const db = createDb(env.DB);
  await db.insert(entries).values({
    username: "legacy_bot",
    kind: "bot",
    categoryId: 1,
    title: "Bot",
    listedAt: 1,
    updatedAt: 1,
  });
  expect((await getEntryByUsername(db, "legacy_bot"))?.startPayload).toBeNull();
  for (const startPayload of ["", "bad payload", "x".repeat(65), "x/y", "a\0b"]) {
    await expect(
      db
        .insert(entries)
        .values({
          username: "bad_bot",
          kind: "bot",
          categoryId: 1,
          title: "Bot",
          listedAt: 1,
          updatedAt: 1,
          startPayload,
        })
        .run(),
    ).rejects.toThrow();
  }
  await expect(
    db
      .insert(entries)
      .values({
        username: "wrong_kind",
        kind: "group",
        categoryId: 1,
        title: "Group",
        listedAt: 1,
        updatedAt: 1,
        startPayload: "ref",
      })
      .run(),
  ).rejects.toThrow();
  const columns = await env.DB.prepare("PRAGMA table_info(submissions)").all<{ name: string }>();
  expect(columns.results.map((col) => col.name)).not.toContain("start_payload");
});

test("conditional payload update writes no rows when unchanged and timestamps only changes", async () => {
  const db = createDb(env.DB);
  const [entry] = await db
    .insert(entries)
    .values({
      username: "curated_bot",
      kind: "bot",
      categoryId: 1,
      title: "Bot",
      listedAt: 1,
      updatedAt: 1,
    })
    .returning();
  if (!entry) throw new Error("missing bot");
  // Observe real D1 results, including the billing metadata for a no-op UPDATE.
  const run = vi.spyOn(Object.getPrototypeOf(db.$client.prepare("SELECT 1")), "run");
  expect(await setEntryStartPayload(db, entry.id, null, 2)).toBe(false);
  expect(await run.mock.results[0]?.value).toMatchObject({ meta: { rows_written: 0 } });
  run.mockRestore();
  expect(await setEntryStartPayload(db, entry.id, "ref", 3)).toBe(true);
  expect(await setEntryStartPayload(db, entry.id, "ref", 4)).toBe(false);
  expect(await getEntryByUsername(db, entry.username)).toMatchObject({
    startPayload: "ref",
    updatedAt: 3,
  });
  expect(await setEntryStartPayload(db, entry.id, null, 5)).toBe(true);
  expect(await getEntryByUsername(db, entry.username)).toMatchObject({
    startPayload: null,
    updatedAt: 5,
  });
  expect(await setEntryStartPayload(db, 99999, "ref", 6)).toBe(false);
});
