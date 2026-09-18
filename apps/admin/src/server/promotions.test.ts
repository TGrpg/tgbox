import type { CoreContext } from "@tgbox/core";
import { beforeEach, describe, expect, test, vi } from "vitest";

const core = vi.hoisted(() => ({
  approveAdOrder: vi.fn(),
  rejectOrder: vi.fn(),
  promotionClickTotals: vi.fn(),
}));
const db = vi.hoisted(() => ({
  listOrders: vi.fn(),
  listProducts: vi.fn(),
  listActivePromotions: vi.fn(),
}));
vi.mock("@tgbox/core", () => core);
vi.mock("@tgbox/db", () => db);

const { loadOrders, rejectPaidOrder, approveOrder } = await import("./promotions.ts");

const ctx = { now: () => Date.UTC(2026, 8, 17) } as CoreContext;

beforeEach(() => vi.clearAllMocks());

describe("rejectPaidOrder", () => {
  test("rejects through core with the admin and reason, reporting the refund", async () => {
    core.rejectOrder.mockResolvedValue({ order: { id: 7, provider: "stars" }, refunded: true });

    const result = await rejectPaidOrder(ctx, { orderId: 7, reason: "违规链接", actor: "tg:900" });

    expect(core.rejectOrder).toHaveBeenCalledWith(ctx, {
      orderId: 7,
      actor: "tg:900",
      reason: "违规链接",
    });
    expect(result).toEqual({ ok: true, refunded: true, provider: "stars" });
  });

  test("an empty reason is stored as none; USDT orders are not refunded automatically", async () => {
    core.rejectOrder.mockResolvedValue({
      order: { id: 8, provider: "cryptopay" },
      refunded: false,
    });

    const result = await rejectPaidOrder(ctx, { orderId: 8, reason: "", actor: "email:a@b.c" });

    expect(core.rejectOrder).toHaveBeenCalledWith(ctx, {
      orderId: 8,
      actor: "email:a@b.c",
      reason: null,
    });
    expect(result).toEqual({ ok: true, refunded: false, provider: "cryptopay" });
  });

  test("an order that is no longer paid cannot be rejected", async () => {
    core.rejectOrder.mockResolvedValue(null);
    expect(await rejectPaidOrder(ctx, { orderId: 9, reason: "", actor: "tg:900" })).toEqual({
      ok: false,
      error: "not_awaiting_review",
    });
  });
});

test("approveOrder reports orders already handled", async () => {
  core.approveAdOrder.mockResolvedValueOnce({ id: 1 }).mockResolvedValueOnce(null);
  expect(await approveOrder(ctx, { orderId: 1, actor: "tg:900" })).toEqual({ ok: true });
  expect(await approveOrder(ctx, { orderId: 1, actor: "tg:900" })).toEqual({
    ok: false,
    error: "not_awaiting_review",
  });
});

test("loadOrders names products, counts clicks and keeps provider ids on the server", async () => {
  db.listOrders.mockResolvedValue({
    rows: [
      { id: 1, productId: 2, invoiceId: "inv", chargeId: "charge", status: "active" },
      { id: 9, productId: 2, invoiceId: null, chargeId: null, status: "expired" },
    ],
    total: 2,
  });
  db.listProducts.mockResolvedValue([{ id: 2, nameZh: "首页横幅 7 天" }]);
  db.listActivePromotions.mockResolvedValue([{ id: 41, orderId: 1 }]);
  core.promotionClickTotals.mockResolvedValue({ 41: { total: 128, recent: 30 } });

  const result = await loadOrders(ctx, { status: undefined, page: 2, pageSize: 20 });

  expect(db.listOrders).toHaveBeenCalledWith(undefined, {
    status: undefined,
    page: 2,
    pageSize: 20,
  });
  expect(result).toEqual({
    rows: [
      {
        id: 1,
        productId: 2,
        status: "active",
        productName: "首页横幅 7 天",
        clicks: { total: 128, recent: 30 },
      },
      // The promotion of order 9 is over and its row is gone, so there is nothing to report.
      { id: 9, productId: 2, status: "expired", productName: "首页横幅 7 天", clicks: null },
    ],
    total: 2,
  });
});
