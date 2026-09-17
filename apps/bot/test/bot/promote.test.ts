import { createOrder, markOrderPaid } from "@tgbox/core";
import { getOrder, insertApprovedEntry, listActivePromotions } from "@tgbox/db";
import { beforeEach, describe, expect, test } from "vitest";
import {
  ADMIN,
  ADMIN_CHAT_ID,
  CRYPTO_PAY_TOKEN,
  core,
  cryptoPaySignature,
  db,
  enableCryptoPay,
  type Harness,
  startHarness,
} from "./harness.ts";

const DAY = 24 * 60 * 60 * 1000;
const HOURLY = "0 * * * *";
const buyer = { id: 4242, is_bot: false, first_name: "Buyer", language_code: "zh-hans" };
const banner = { title: "好频道", subtitle: "每天更新好内容", href: "https://t.me/good_channel" };
const reviewMessage = {
  message_id: 88,
  date: 0,
  chat: { id: ADMIN_CHAT_ID, type: "supergroup", title: "Admins" },
  text: "🖼 首页横幅待审核",
};

let h: Harness;
beforeEach(async () => {
  h = await startHarness();
  await insertApprovedEntry(db, {
    entry: { username: "pin_me", kind: "channel", categoryId: 1, title: "Pin Me", listedAt: 1 },
    stats: { members: 10, online: null, activityTier: null, statsWrittenAt: 1 },
    tagIds: [],
    now: 1,
  });
});

const press = async (prefix: string) => {
  const button = h.lastButtons().find((b) => b.callback_data?.startsWith(prefix));
  if (!button?.callback_data) throw new Error(`no ${prefix} button`);
  await h.callback(buyer, button.callback_data);
  return button.callback_data;
};

async function order(input: { productId: number; targetUsername?: string; banner?: unknown }) {
  const result = await createOrder(core, { tgUserId: buyer.id, ...input });
  if (!result.ok) throw new Error(result.error);
  return result.order;
}

const preCheckout = (orderId: number, totalAmount: number) =>
  h.update({
    pre_checkout_query: {
      id: `q${orderId}`,
      from: buyer,
      currency: "XTR",
      total_amount: totalAmount,
      invoice_payload: `order:${orderId}`,
    },
  });

const successfulPayment = (orderId: number, chargeId: string) =>
  h.update({
    message: {
      message_id: 9,
      date: 0,
      chat: { id: buyer.id, type: "private" },
      from: buyer,
      successful_payment: {
        currency: "XTR",
        total_amount: 500,
        invoice_payload: `order:${orderId}`,
        telegram_payment_charge_id: chargeId,
        provider_payment_charge_id: "",
      },
    },
  });

const invoicePaid = (orderId: number, amount = "20") =>
  JSON.stringify({
    update_id: 1,
    update_type: "invoice_paid",
    request_date: "2026-09-17T00:00:00.000Z",
    payload: {
      invoice_id: 777,
      status: "paid",
      amount,
      asset: "USDT",
      payload: `order:${orderId}`,
    },
  });

describe("buying a pin with Stars", () => {
  test("/promote → product → @username → Stars sends an XTR invoice for the order", async () => {
    await h.message(buyer, "/promote");
    expect(h.lastButtons().map((b) => b.callback_data)).toEqual(["pp:1", "pp:2", "pp:3", "pp:4"]);
    expect(h.lastButtons()[0]?.text).toContain("⭐500");

    await press("pp:1");
    expect(h.lastText()).toContain("已收录");
    await h.message(buyer, "@not_listed_yet");
    expect(h.lastText()).toContain("还没有被收录");

    await h.message(buyer, "https://t.me/pin_me");
    expect(h.lastText()).toContain("置顶 @pin_me");
    // USDT is off by default, so Stars is the only method.
    expect(h.lastButtons().map((b) => b.callback_data)).toEqual([
      expect.stringMatching(/^ps:\d+$/),
    ]);

    const data = await press("ps:");
    const orderId = Number(data.slice(3));
    expect(await getOrder(db, orderId)).toMatchObject({
      status: "pending",
      targetUsername: "pin_me",
    });
    expect(h.calls("sendInvoice")[0]?.payload).toMatchObject({
      chat_id: buyer.id,
      currency: "XTR",
      provider_token: "",
      payload: `order:${orderId}`,
      prices: [{ amount: 500 }],
    });
  });

  test("pre-checkout accepts the matching pending order and rejects a wrong amount", async () => {
    const pin = await order({ productId: 1, targetUsername: "@pin_me" });
    await preCheckout(pin.id, 400);
    await preCheckout(pin.id, 500);
    expect(h.calls("answerPreCheckoutQuery").map((c) => c.payload)).toEqual([
      expect.objectContaining({ ok: false, error_message: expect.stringContaining("失效") }),
      expect.objectContaining({ ok: true }),
    ]);
  });

  test("pre-checkout rejects an order whose slots are gone", async () => {
    const pin = await order({ productId: 1, targetUsername: "@pin_me" });
    for (let i = 0; i < 10; i++) {
      const other = await order({ productId: 1, targetUsername: "@pin_me" });
      await markOrderPaid(core, {
        orderId: other.id,
        provider: "manual",
        chargeId: `m${i}`,
        amount: "0",
        currency: "XTR",
      });
    }
    await preCheckout(pin.id, 500);
    expect(h.calls("answerPreCheckoutQuery")[0]?.payload).toMatchObject({ ok: false });
  });

  test("a successful payment activates the pin once and tells the buyer", async () => {
    const pin = await order({ productId: 1, targetUsername: "@pin_me" });
    await successfulPayment(pin.id, "charge_1");
    await successfulPayment(pin.id, "charge_1");

    expect(await getOrder(db, pin.id)).toMatchObject({
      status: "active",
      provider: "stars",
      chargeId: "charge_1",
      amount: "500",
      currency: "XTR",
    });
    expect(await listActivePromotions(db, Date.now(), "pin")).toMatchObject([
      { orderId: pin.id, entryUsername: "pin_me" },
    ]);
    const notices = h.calls("sendMessage").filter((c) => c.payload.chat_id === buyer.id);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.payload.text).toContain("已置顶 7 天");
  });

  test("a second charge for an already paid order is refunded", async () => {
    const pin = await order({ productId: 1, targetUsername: "@pin_me" });
    await successfulPayment(pin.id, "charge_1");
    await successfulPayment(pin.id, "charge_2");
    expect(h.calls("refundStarPayment").map((c) => c.payload)).toEqual([
      { user_id: buyer.id, telegram_payment_charge_id: "charge_2" },
    ]);
  });
});

describe("paying with USDT through Crypto Pay", () => {
  test("the USDT button creates an invoice and links to it", async () => {
    await enableCryptoPay();
    const pin = await order({ productId: 1, targetUsername: "@pin_me" });
    await h.callback(buyer, `pu:${pin.id}`);
    expect(h.cryptoPay).toEqual([
      {
        url: "https://testnet-pay.crypt.bot/api/createInvoice",
        body: expect.objectContaining({
          asset: "USDT",
          amount: "10",
          payload: `order:${pin.id}`,
          expires_in: 3600,
        }),
      },
    ]);
    expect(await getOrder(db, pin.id)).toMatchObject({ invoiceId: "777" });
    expect(h.lastButtons()).toEqual([
      expect.objectContaining({ url: "https://t.me/CryptoTestnetBot?start=IVtest" }),
    ]);
  });

  test("a webhook with a bad signature is refused and changes nothing", async () => {
    await enableCryptoPay();
    const bannerOrder = await order({ productId: 3, banner });
    const body = invoicePaid(bannerOrder.id);
    expect((await h.cryptoPayWebhook(body, null)).status).toBe(401);
    const forged = await cryptoPaySignature(body, "wrong-token");
    expect((await h.cryptoPayWebhook(body, forged)).status).toBe(401);
    expect(await getOrder(db, bannerOrder.id)).toMatchObject({ status: "pending" });
    expect(h.telegram).toEqual([]);
  });

  test("a signed invoice_paid marks the banner paid and sends it to review", async () => {
    await enableCryptoPay();
    const bannerOrder = await order({ productId: 3, banner });
    const body = invoicePaid(bannerOrder.id);
    const response = await h.cryptoPayWebhook(
      body,
      await cryptoPaySignature(body, CRYPTO_PAY_TOKEN),
    );

    expect(response.status).toBe(200);
    expect(await getOrder(db, bannerOrder.id)).toMatchObject({
      status: "paid",
      provider: "cryptopay",
      chargeId: "777",
      amount: "20",
      currency: "USDT",
    });
    const buyerNotice = h.calls("sendMessage").find((c) => c.payload.chat_id === buyer.id);
    expect(buyerNotice?.payload.text).toContain("横幅已提交审核");
    expect(buyerNotice?.payload.text).toContain("awaiting review");
    const review = h
      .calls("sendMessage")
      .find((c) => String(c.payload.chat_id) === String(ADMIN_CHAT_ID));
    expect(review?.payload.text).toContain("好频道");
    expect(h.lastButtons().map((b) => b.callback_data)).toEqual([
      `ba:${bannerOrder.id}`,
      `bj:${bannerOrder.id}`,
    ]);
  });
});

describe("reviewing paid banners", () => {
  async function paidBanner(provider: "stars" | "cryptopay") {
    const bannerOrder = await order({ productId: 3, banner });
    await markOrderPaid(core, {
      orderId: bannerOrder.id,
      provider,
      chargeId: `${provider}_charge`,
      amount: provider === "stars" ? "1000" : "20",
      currency: provider === "stars" ? "XTR" : "USDT",
    });
    return bannerOrder.id;
  }

  test("only admins can approve; approval starts the banner and tells the buyer", async () => {
    const id = await paidBanner("stars");
    await h.callback(buyer, `ba:${id}`, reviewMessage);
    expect(await getOrder(db, id)).toMatchObject({ status: "paid" });

    await h.callback(ADMIN, `ba:${id}`, reviewMessage);
    expect(await getOrder(db, id)).toMatchObject({ status: "active" });
    expect(await listActivePromotions(db, Date.now(), "banner")).toMatchObject([
      { orderId: id, banner },
    ]);
    expect(h.calls("editMessageText")[0]?.payload.text).toContain("已通过（@alice_admin）");
    const notice = h.calls("sendMessage").find((c) => c.payload.chat_id === buyer.id);
    expect(notice?.payload.text).toContain("已通过审核并上线");
  });

  test("rejecting a Stars banner refunds it automatically", async () => {
    const id = await paidBanner("stars");
    await h.callback(ADMIN, `bj:${id}`, reviewMessage);
    expect(h.calls("refundStarPayment").map((c) => c.payload)).toEqual([
      { user_id: buyer.id, telegram_payment_charge_id: "stars_charge" },
    ]);
    expect(await getOrder(db, id)).toMatchObject({ status: "refunded" });
    expect(h.calls("editMessageText")[0]?.payload.text).toContain("已自动退款");
    const notice = h.calls("sendMessage").find((c) => c.payload.chat_id === buyer.id);
    expect(notice?.payload.text).toContain("Stars 已原路退回");
  });

  test("rejecting a USDT banner asks the buyer to contact support", async () => {
    const id = await paidBanner("cryptopay");
    await h.callback(ADMIN, `bj:${id}`, reviewMessage);
    expect(h.calls("refundStarPayment")).toEqual([]);
    expect(await getOrder(db, id)).toMatchObject({ status: "rejected" });
    expect(h.calls("editMessageText")[0]?.payload.text).toContain("需人工退款 20 USDT");
    const notice = h.calls("sendMessage").find((c) => c.payload.chat_id === buyer.id);
    expect(notice?.payload.text).toContain(`联系客服办理退款（订单 #${id}）`);
  });
});

describe("hourly promotion maintenance", () => {
  test("buyers are reminded a day before the end, then told when it ended", async () => {
    const pin = await order({ productId: 1, targetUsername: "@pin_me" });
    await markOrderPaid(core, {
      orderId: pin.id,
      provider: "stars",
      chargeId: "c1",
      amount: "500",
      currency: "XTR",
    });
    const endsAt = (await getOrder(db, pin.id))?.endsAt ?? 0;

    // The per-minute trigger only refreshes entries.
    await h.scheduled(endsAt - 2 * 60 * 60 * 1000, "* * * * *");
    expect(h.calls("sendMessage").filter((c) => c.payload.chat_id === buyer.id)).toEqual([]);

    await h.scheduled(endsAt - 2 * 60 * 60 * 1000, HOURLY);
    await h.scheduled(endsAt - 60 * 60 * 1000, HOURLY);
    const reminders = h.calls("sendMessage").filter((c) => c.payload.chat_id === buyer.id);
    expect(reminders).toHaveLength(1);
    expect(reminders[0]?.payload.text).toContain("/promote 续费");

    h.reset();
    await h.scheduled(endsAt + 60 * 60 * 1000, HOURLY);
    expect(await getOrder(db, pin.id)).toMatchObject({ status: "expired" });
    expect(await listActivePromotions(db, endsAt - DAY, "pin")).toEqual([]);
    const ended = h.calls("sendMessage").filter((c) => c.payload.chat_id === buyer.id);
    expect(ended).toHaveLength(1);
    expect(ended[0]?.payload.text).toContain("已到期下架");
  });
});
