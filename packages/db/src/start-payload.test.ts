import { env } from "cloudflare:workers";
import { expect, test } from "vitest";
import { createDb, createSubmission, getSubmission, syncTaxonomy } from "./index.ts";

test("migrated D1 persists nullable payload and enforces bot-only Telegram grammar", async () => {
  const db = createDb(env.DB);
  await syncTaxonomy(db);
  const base = { tgUserId: 42, kind: "bot" as const, categoryId: 1, tagIds: [], createdAt: 1 };
  const id = await createSubmission(db, { ...base, username: "legacy_bot" });
  if (id === null) throw new Error("missing legacy submission");
  expect((await getSubmission(db, id))?.startPayload).toBeNull();
  for (const payload of ["", "bad payload", "x".repeat(65), "x/y", "a\0b"]) {
    await expect(
      createSubmission(db, { ...base, username: `bad_${payload.length}`, startPayload: payload }),
    ).rejects.toThrow();
  }
  await expect(
    createSubmission(db, {
      ...base,
      username: "wrong_kind",
      kind: "group",
      startPayload: "botlist",
    }),
  ).rejects.toThrow();
  const good = await createSubmission(db, {
    ...base,
    username: "tagged_bot",
    startPayload: "botlist",
  });
  if (good === null) throw new Error("missing tagged submission");
  expect((await getSubmission(db, good))?.startPayload).toBe("botlist");
});
