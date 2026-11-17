import {
  createOrder,
  quoteUsdtOrder,
  updateSettings,
  upsertProduct,
  watchUsdtPayments,
} from "@tgbox/core";
import {
  createUsdtPayment,
  expireUsdtPayments,
  getUsdtPayment,
  insertApprovedEntry,
} from "@tgbox/db";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { actor, auditRows, db, NOW, setup } from "./fake.ts";

const ADDRESS = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const MINUTE = 60_000;

type Harness = Awaited<ReturnType<typeof setup>>;

/** A payments-enabled context with one 10 USDT pin product and one pending order for it. */
async function withOrder(harness: Harness) {
  await updateSettings(harness.ctx, {
    key: "payments",
    value: {
      starsEnabled: false,
      cryptoPayEnabled: false,
      cryptoPayNetwork: "mainnet",
      usdtSelfEnabled: true,
      usdtAddress: ADDRESS,
      usdtExpiryMinutes: 30,
    },
    actor,
  });
  const product = await upsertProduct(harness.ctx, {
    kind: "pin",
    nameZh: "置顶 7 天",
    nameEn: "Pin 7 days",
    days: 7,
    priceStars: 500,
    priceUsdt: "10",
    active: true,
    sort: 0,
    actor,
  });
  if (!product.ok) throw new Error("product failed");
  await insertApprovedEntry(db, {
    entry: { username: "target", kind: "channel", categoryId: 1, title: "Target", listedAt: NOW },
    stats: { members: 1, online: null, activityTier: null, statsWrittenAt: NOW },
    tagIds: [],
    now: NOW,
  });
  const created = await createOrder(harness.ctx, {
    tgUserId: 42,
    productId: product.id,
    targetUsername: "target",
  });
  if (!created.ok) throw new Error(`order failed: ${created.error}`);
  return { product: { id: product.id }, order: created.order };
}

const transfer = (value: number, at: number, id = "tx-1") => ({
  transaction_id: id,
  block_timestamp: at,
  value: String(value),
});

let harness: Harness;
beforeEach(async () => {
  harness = await setup({ SETTINGS_KEY: "0".repeat(64) });
});

describe("quoting an order", () => {
  test("hands out an amount above the price, unique to the order", async () => {
    const { order, product } = await withOrder(harness);
    const quote = await quoteUsdtOrder(harness.ctx, {
      orderId: order.id,
      productId: product.id,
    });
    expect(quote.ok).toBe(true);
    if (!quote.ok) return;
    expect(quote.quote.address).toBe(ADDRESS);
    expect(quote.quote.amountMicro).toBeGreaterThan(10_000_000);
    expect(quote.quote.expiresAt).toBe(NOW + 30 * MINUTE);
  });

  test("re-quoting returns the same amount, so a first transfer is never stranded", async () => {
    const { order, product } = await withOrder(harness);
    const first = await quoteUsdtOrder(harness.ctx, { orderId: order.id, productId: product.id });
    const second = await quoteUsdtOrder(harness.ctx, { orderId: order.id, productId: product.id });
    expect(first.ok && second.ok).toBe(true);
    if (!(first.ok && second.ok)) return;
    expect(second.quote.amountMicro).toBe(first.quote.amountMicro);
  });

  test("concurrent quotes cannot reserve the same amount", async () => {
    const { order, product } = await withOrder(harness);
    const other = await createOrder(harness.ctx, {
      tgUserId: 43,
      productId: product.id,
      targetUsername: "target",
    });
    if (!other.ok) throw new Error("order failed");
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const quotes = await Promise.all(
        [order, other.order].map((row) =>
          quoteUsdtOrder(harness.ctx, { orderId: row.id, productId: product.id }),
        ),
      );
      expect(quotes.every((quote) => quote.ok)).toBe(true);
      const amounts = quotes.flatMap((quote) => (quote.ok ? [quote.quote.amountMicro] : []));
      expect(new Set(amounts).size).toBe(2);
    } finally {
      random.mockRestore();
    }
  });

  test("the database refuses a duplicate pending amount without replacing either quote", async () => {
    const row = {
      orderId: 100,
      amountMicro: 10_000_100,
      address: ADDRESS,
      createdAt: NOW,
      expiresAt: NOW + 30 * MINUTE,
    };
    expect(await createUsdtPayment(db, row)).toMatchObject({ orderId: 100 });
    expect(await createUsdtPayment(db, { ...row, orderId: 101 })).toBeUndefined();
    expect((await getUsdtPayment(db, 100))?.amountMicro).toBe(row.amountMicro);
  });

  test.each([false, true])(
    "an expired quote must be replaced by a new order (swept: %s)",
    async (swept) => {
      const { order, product } = await withOrder(harness);
      const first = await quoteUsdtOrder(harness.ctx, { orderId: order.id, productId: product.id });
      if (!first.ok) throw new Error("quote failed");
      if (swept) await expireUsdtPayments(db, NOW + 31 * MINUTE);
      const before = await getUsdtPayment(db, order.id);
      expect(
        await quoteUsdtOrder(
          { ...harness.ctx, now: () => NOW + 31 * MINUTE },
          {
            orderId: order.id,
            productId: product.id,
          },
        ),
      ).toEqual({ ok: false, error: "order_expired" });
      expect(await getUsdtPayment(db, order.id)).toEqual(before);
    },
  );

  test("refuses when the method is off, rather than quoting an address nobody watches", async () => {
    const { order, product } = await withOrder(harness);
    await updateSettings(harness.ctx, {
      key: "payments",
      value: {
        starsEnabled: false,
        cryptoPayEnabled: false,
        cryptoPayNetwork: "mainnet",
        usdtSelfEnabled: false,
        usdtAddress: ADDRESS,
        usdtExpiryMinutes: 30,
      },
      actor,
    });
    const quote = await quoteUsdtOrder(harness.ctx, { orderId: order.id, productId: product.id });
    expect(quote).toEqual({ ok: false, error: "disabled" });
  });

  test("refuses when no receiving address is configured", async () => {
    const { order, product } = await withOrder(harness);
    await updateSettings(harness.ctx, {
      key: "payments",
      value: {
        starsEnabled: false,
        cryptoPayEnabled: false,
        cryptoPayNetwork: "mainnet",
        usdtSelfEnabled: true,
        usdtAddress: "",
        usdtExpiryMinutes: 30,
      },
      actor,
    });
    const quote = await quoteUsdtOrder(harness.ctx, { orderId: order.id, productId: product.id });
    expect(quote).toEqual({ ok: false, error: "not_configured" });
  });
});

describe("settling transfers", () => {
  test("does not call the chain when nothing is pending", async () => {
    await withOrder(harness);
    const settle = vi.fn();
    const result = await watchUsdtPayments(harness.ctx, settle);
    expect(harness.tron.calls).toEqual([]);
    expect(settle).not.toHaveBeenCalled();
    expect(result.matched).toEqual([]);
  });

  test("an exact transfer settles the order once", async () => {
    const { order, product } = await withOrder(harness);
    const quote = await quoteUsdtOrder(harness.ctx, { orderId: order.id, productId: product.id });
    if (!quote.ok) throw new Error("quote failed");
    harness.tron.transfers = [transfer(quote.quote.amountMicro, NOW + MINUTE)];

    const settle = vi.fn();
    const result = await watchUsdtPayments(harness.ctx, settle);

    expect(result.matched).toEqual([
      { orderId: order.id, txHash: "tx-1", amount: quote.quote.amount },
    ]);
    expect(settle).toHaveBeenCalledTimes(1);
    expect((await getUsdtPayment(db, order.id))?.status).toBe("paid");
    expect((await getUsdtPayment(db, order.id))?.txHash).toBe("tx-1");
  });

  test("the last quote still settles an on-time transfer first seen after expiry", async () => {
    const { order, product } = await withOrder(harness);
    const quote = await quoteUsdtOrder(harness.ctx, { orderId: order.id, productId: product.id });
    if (!quote.ok) throw new Error("quote failed");
    harness.tron.transfers = [transfer(quote.quote.amountMicro, NOW + 29 * MINUTE)];
    const settle = vi.fn();
    await watchUsdtPayments({ ...harness.ctx, now: () => NOW + 31 * MINUTE }, settle);
    expect(settle).toHaveBeenCalledOnce();
    expect((await getUsdtPayment(db, order.id))?.status).toBe("paid");
  });

  test("confirmation grace keeps the amount reserved until a successful final scan", async () => {
    const { order, product } = await withOrder(harness);
    await quoteUsdtOrder(harness.ctx, { orderId: order.id, productId: product.id });
    await watchUsdtPayments({ ...harness.ctx, now: () => NOW + 40 * MINUTE }, vi.fn());
    expect((await getUsdtPayment(db, order.id))?.status).toBe("pending");
    harness.tron.status = 502;
    await watchUsdtPayments({ ...harness.ctx, now: () => NOW + 50 * MINUTE }, vi.fn());
    expect((await getUsdtPayment(db, order.id))?.status).toBe("pending");
    harness.tron.status = 200;
    await watchUsdtPayments({ ...harness.ctx, now: () => NOW + 51 * MINUTE }, vi.fn());
    expect((await getUsdtPayment(db, order.id))?.status).toBe("expired");
  });

  test("after a long outage the watcher still requests the quote's whole payment window", async () => {
    const { order, product } = await withOrder(harness);
    const quote = await quoteUsdtOrder(harness.ctx, { orderId: order.id, productId: product.id });
    if (!quote.ok) throw new Error("quote failed");
    harness.tron.transfers = [transfer(quote.quote.amountMicro, NOW + 29 * MINUTE)];
    const settle = vi.fn();
    await watchUsdtPayments({ ...harness.ctx, now: () => NOW + 300 * MINUTE }, settle);
    expect(settle).toHaveBeenCalledOnce();
    expect(new URL(harness.tron.calls[0] ?? "").searchParams.get("min_block_timestamp")).toBe(
      String(NOW),
    );
  });

  test("a transfer whose settling failed is settled again on the next tick", async () => {
    const { order, product } = await withOrder(harness);
    const quote = await quoteUsdtOrder(harness.ctx, { orderId: order.id, productId: product.id });
    if (!quote.ok) throw new Error("quote failed");
    harness.tron.transfers = [transfer(quote.quote.amountMicro, NOW + MINUTE)];

    const failing = vi.fn().mockRejectedValue(new Error("D1 hiccup"));
    const first = await watchUsdtPayments(harness.ctx, failing);
    expect(first.matched).toEqual([]);
    expect((await getUsdtPayment(db, order.id))?.status).toBe("pending");

    const settle = vi.fn();
    await watchUsdtPayments(harness.ctx, settle);
    expect(settle).toHaveBeenCalledOnce();
    expect((await getUsdtPayment(db, order.id))?.status).toBe("paid");
  });

  test("the same transfer seen again settles nothing", async () => {
    const { order, product } = await withOrder(harness);
    const quote = await quoteUsdtOrder(harness.ctx, { orderId: order.id, productId: product.id });
    if (!quote.ok) throw new Error("quote failed");
    harness.tron.transfers = [transfer(quote.quote.amountMicro, NOW + MINUTE)];

    const settle = vi.fn();
    await watchUsdtPayments(harness.ctx, settle);
    const second = await watchUsdtPayments(harness.ctx, settle);

    expect(settle).toHaveBeenCalledTimes(1);
    expect(second.matched).toEqual([]);
  });

  test("the round price does not settle an order quoted with a tail", async () => {
    const { order, product } = await withOrder(harness);
    await quoteUsdtOrder(harness.ctx, { orderId: order.id, productId: product.id });
    harness.tron.transfers = [transfer(10_000_000, NOW + MINUTE)];

    const settle = vi.fn();
    const result = await watchUsdtPayments(harness.ctx, settle);

    expect(settle).not.toHaveBeenCalled();
    expect(result.unmatched).toBe(1);
    expect((await auditRows()).some((row) => row.action === "usdt.unmatched")).toBe(true);
  });

  test("a transfer predating the order cannot settle it", async () => {
    const { order, product } = await withOrder(harness);
    const quote = await quoteUsdtOrder(harness.ctx, { orderId: order.id, productId: product.id });
    if (!quote.ok) throw new Error("quote failed");
    // The receiving address is reused forever, so an old transfer may carry today's amount.
    harness.tron.transfers = [transfer(quote.quote.amountMicro, NOW - MINUTE)];

    const settle = vi.fn();
    const result = await watchUsdtPayments(harness.ctx, settle);

    expect(settle).not.toHaveBeenCalled();
    expect(result.unmatched).toBe(1);
  });

  test("a transfer of another token on the same address is ignored", async () => {
    const { order, product } = await withOrder(harness);
    const quote = await quoteUsdtOrder(harness.ctx, { orderId: order.id, productId: product.id });
    if (!quote.ok) throw new Error("quote failed");
    harness.tron.transfers = [
      {
        ...transfer(quote.quote.amountMicro, NOW + MINUTE),
        token_info: { address: "TOtherToken" },
      },
    ];

    const settle = vi.fn();
    await watchUsdtPayments(harness.ctx, settle);
    expect(settle).not.toHaveBeenCalled();
  });

  test("a TronGrid outage leaves the order pending for the next tick", async () => {
    const { order, product } = await withOrder(harness);
    await quoteUsdtOrder(harness.ctx, { orderId: order.id, productId: product.id });
    harness.tron.status = 502;

    const settle = vi.fn();
    await expect(watchUsdtPayments(harness.ctx, settle)).resolves.toMatchObject({ matched: [] });
    expect((await getUsdtPayment(db, order.id))?.status).toBe("pending");
  });

  test("a thrown fetch does not take the whole cron down", async () => {
    const { order, product } = await withOrder(harness);
    await quoteUsdtOrder(harness.ctx, { orderId: order.id, productId: product.id });
    harness.tron.throws = true;

    await expect(watchUsdtPayments(harness.ctx, vi.fn())).resolves.toMatchObject({ matched: [] });
    expect((await getUsdtPayment(db, order.id))?.status).toBe("pending");
  });

  test("only confirmed transfers to the address are requested", async () => {
    const { order, product } = await withOrder(harness);
    await quoteUsdtOrder(harness.ctx, { orderId: order.id, productId: product.id });
    await watchUsdtPayments(harness.ctx, vi.fn());

    const url = new URL(harness.tron.calls[0] ?? "");
    expect(url.pathname).toContain(ADDRESS);
    expect(url.searchParams.get("only_to")).toBe("true");
    expect(url.searchParams.get("only_confirmed")).toBe("true");
  });
});
