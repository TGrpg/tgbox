import { env } from "cloudflare:workers";
import { expect, test } from "vitest";

test("the unique-amount migration quarantines all ambiguous quotes and preserves history", async () => {
  await env.DB.prepare("DROP INDEX usdt_pending_amount").run();
  await env.DB.prepare(`INSERT INTO usdt_payments
    (order_id, amount_micro, address, status, created_at, expires_at)
    VALUES (1, 10000100, 'address', 'pending', 10, 20),
           (2, 10000100, 'address', 'pending', 10, 20),
           (3, 10000200, 'address', 'pending', 10, 20),
           (4, 10000200, 'address', 'paid', 10, 20)`).run();
  const migration = env.TEST_MIGRATIONS.find((item) => item.name.startsWith("0022_"));
  if (!migration) throw new Error("migration missing");
  if (migration.queries.length)
    await env.DB.batch(migration.queries.map((sql) => env.DB.prepare(sql)));
  const { results } = await env.DB.prepare(
    "SELECT order_id, status FROM usdt_payments ORDER BY order_id",
  ).all();
  expect(results).toEqual([
    { order_id: 1, status: "expired" },
    { order_id: 2, status: "expired" },
    { order_id: 3, status: "pending" },
    { order_id: 4, status: "paid" },
  ]);
  expect(
    (
      await env.DB.prepare(
        "SELECT target FROM audit_log WHERE action = 'usdt.amount_conflict' ORDER BY target",
      ).all()
    ).results,
  ).toEqual([{ target: "order:1" }, { target: "order:2" }]);
  await expect(
    env.DB.prepare(`INSERT INTO usdt_payments
    (order_id, amount_micro, address, created_at, expires_at)
    VALUES (5, 10000200, 'address', 30, 40)`).run(),
  ).rejects.toThrow();
});
