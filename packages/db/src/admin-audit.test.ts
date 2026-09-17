import { env } from "cloudflare:workers";
import { expect, test } from "vitest";
import { createDb, insertAuditLog, listAuditActors, listAuditLogFiltered } from "./index.ts";

const db = createDb(env.DB);

test("audit log pages newest first and filters by action and actor", async () => {
  const rows = [
    { actor: "tg:1", action: "entry.status" },
    { actor: "email:a@x.io", action: "tag.update" },
    { actor: "tg:1", action: "tag.update" },
    { actor: "tg:1", action: "tag.update" },
  ];
  for (const [index, { actor, action }] of rows.entries()) {
    await insertAuditLog(db, { actor, action, target: null, payload: { index }, createdAt: index });
  }

  const first = await listAuditLogFiltered(db, { limit: 1, action: "tag.update", actor: "tg:1" });
  expect(first.rows.map((row) => row.payload)).toEqual([{ index: 3 }]);
  const second = await listAuditLogFiltered(db, {
    limit: 1,
    action: "tag.update",
    actor: "tg:1",
    cursor: first.nextCursor ?? undefined,
  });
  expect(second).toMatchObject({ rows: [{ payload: { index: 2 } }], nextCursor: null });
  expect((await listAuditLogFiltered(db, { limit: 10 })).rows).toHaveLength(4);
  expect(await listAuditActors(db)).toEqual(["email:a@x.io", "tg:1"]);
});
