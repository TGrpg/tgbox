import type { CoreContext } from "@tgbox/core";
import { beforeEach, expect, test, vi } from "vitest";

const core = vi.hoisted(() => ({ promotionClickTotals: vi.fn(), promotionClickHistory: vi.fn() }));
const db = vi.hoisted(() => ({ listActivePromotions: vi.fn() }));
vi.mock("@tgbox/core", () => core);
vi.mock("@tgbox/db", () => db);

const { ClickHistoryInput, clicksByOrder, loadActivePromotions, loadClickHistory } = await import(
  "./clicks.ts"
);

const NOW = Date.UTC(2026, 8, 17);
const ctx = { now: () => NOW } as CoreContext;

const promotion = (id: number, orderId: number | null) => ({ id, orderId, kind: "banner" });

beforeEach(() => vi.clearAllMocks());

test("every live promotion carries a click count, zero included", async () => {
  db.listActivePromotions.mockResolvedValue([promotion(1, 10), promotion(2, null)]);
  core.promotionClickTotals.mockResolvedValue({ 1: { total: 42, recent: 7 } });

  const result = await loadActivePromotions(ctx);

  expect(core.promotionClickTotals).toHaveBeenCalledWith(ctx, [1, 2]);
  expect(result.now).toBe(NOW);
  expect(result.rows.map((row) => [row.id, row.clicks])).toEqual([
    [1, { total: 42, recent: 7 }],
    [2, { total: 0, recent: 0 }],
  ]);
});

test("orders are matched to the promotion they produced", async () => {
  db.listActivePromotions.mockResolvedValue([
    promotion(1, 10),
    promotion(2, 99), // another page's order
    promotion(3, null), // created by hand, belongs to no order
  ]);
  core.promotionClickTotals.mockResolvedValue({ 1: { total: 5, recent: 5 } });

  expect(await clicksByOrder(ctx, [10, 11])).toEqual({ 10: { total: 5, recent: 5 } });
  // Only the promotions of the requested orders are counted.
  expect(core.promotionClickTotals).toHaveBeenCalledWith(ctx, [1]);
});

test("an order whose promotion already ended reports nothing rather than zero", async () => {
  db.listActivePromotions.mockResolvedValue([]);
  core.promotionClickTotals.mockResolvedValue({});

  expect(await clicksByOrder(ctx, [10])).toEqual({});
});

test("no orders means no queries at all", async () => {
  expect(await clicksByOrder(ctx, [])).toEqual({});
  expect(db.listActivePromotions).not.toHaveBeenCalled();
  expect(core.promotionClickTotals).not.toHaveBeenCalled();
});

test("loadClickHistory passes the validated window through to core", async () => {
  core.promotionClickHistory.mockResolvedValue([{ day: "2026-09-17", clicks: 3 }]);

  const input = ClickHistoryInput.parse({ promotionId: 7, days: 30 });
  expect(await loadClickHistory(ctx, input)).toEqual([{ day: "2026-09-17", clicks: 3 }]);
  expect(core.promotionClickHistory).toHaveBeenCalledWith(ctx, { promotionId: 7, days: 30 });
});

test.each([
  [{ promotionId: 0 }, false],
  [{ promotionId: -1 }, false],
  [{ promotionId: 7 }, true],
  [{ promotionId: 7, days: 0 }, false],
  [{ promotionId: 7, days: 91 }, false],
  [{ promotionId: 7, days: 14 }, true],
])("ClickHistoryInput %o accepted: %s", (input, ok) => {
  expect(ClickHistoryInput.safeParse(input).success).toBe(ok);
});
