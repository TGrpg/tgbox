import { env } from "cloudflare:workers";
import { createOrder, markOrderPaid } from "@tgbox/core";
import {
  getBotDraft,
  getOrder,
  getSiteState,
  insertApprovedEntry,
  listActivePromotions,
  setSiteState,
} from "@tgbox/db";
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
  setPaymentSettings,
  startHarness,
} from "./harness.ts";

const ADDRESS = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

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

describe("prices follow the enabled payment methods", () => {
  /** The keyboard labels plus the message text of everything the bot said. */
  const said = () =>
    h
      .calls("sendMessage")
      .flatMap((call) => [
        String(call.payload.text ?? ""),
        JSON.stringify(call.payload.reply_markup ?? ""),
      ])
      .join("\n");

  test("with Stars off, no Stars price is quoted anywhere in the flow", async () => {
    // An operator who turned Stars off was still shown "⭐800" on every product button and in the
    // order summary, quoting a price nobody could pay.
    await setPaymentSettings({ starsEnabled: false, usdtSelfEnabled: true, usdtAddress: ADDRESS });
    await h.message(buyer, "/promote");
    expect(said()).not.toContain("⭐");
    expect(said()).toContain("USDT");
  });

  test("with only Stars on, no USDT price is quoted", async () => {
    await setPaymentSettings({ starsEnabled: true });
    await h.message(buyer, "/promote");
    expect(said()).toContain("⭐");
    expect(said()).not.toContain("USDT");
  });

  test("both on quotes both", async () => {
    await setPaymentSettings({ starsEnabled: true, usdtSelfEnabled: true, usdtAddress: ADDRESS });
    await h.message(buyer, "/promote");
    expect(said()).toContain("⭐");
    expect(said()).toContain("USDT");
  });

  test("the order summary drops the price of a method turned off mid-purchase", async () => {
    await setPaymentSettings({ starsEnabled: false, usdtSelfEnabled: true, usdtAddress: ADDRESS });
    await h.message(buyer, "/promote");
    await h.callback(buyer, "pp:1");
    await h.message(buyer, "@pin_me");
    expect(said()).not.toContain("⭐");
  });
});

describe("buying a home banner", () => {
  const photo = (fileSize: number) => ({
    photo: [
      { file_id: "small", file_unique_id: "s", width: 90, height: 60, file_size: 2000 },
      { file_id: "big", file_unique_id: "b", width: 1280, height: 720, file_size: fileSize },
    ],
  });

  /** Walks the banner steps up to the image prompt and returns nothing. */
  async function fillBanner() {
    await h.message(buyer, "/promote");
    await press("pp:3");
    await h.message(buyer, banner.title);
    await h.message(buyer, banner.subtitle);
    await h.message(buyer, banner.href);
  }

  test("the image is asked for after the link and stored under the order id", async () => {
    await fillBanner();
    expect(h.lastText()).toContain("/skip");

    h.serveFile(() => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    await h.media(buyer, photo(150_000));

    // The largest size under ~200KB is the one downloaded.
    expect(h.calls("getFile")[0]?.payload).toEqual({ file_id: "big" });
    expect(h.files[0]).toContain("photos/file_1.jpg");

    const orderId = Number(String(h.lastButtons()[0]?.callback_data).slice(3));
    expect(await getOrder(db, orderId)).toMatchObject({
      status: "pending",
      banner: { ...banner, imageUrl: `https://media.tgbox.test/promos/${orderId}.jpg` },
    });
    const stored = await env.MEDIA.get(`promos/${orderId}.jpg`);
    expect(stored?.httpMetadata?.contentType).toBe("image/jpeg");
    expect(new Uint8Array(await (stored as R2ObjectBody).arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  test("/skip creates the same order without an image", async () => {
    await fillBanner();
    await h.message(buyer, "/skip");

    expect(h.calls("getFile")).toEqual([]);
    const orderId = Number(String(h.lastButtons()[0]?.callback_data).slice(3));
    const order = await getOrder(db, orderId);
    expect(order).toMatchObject({ status: "pending", banner });
    expect(order?.banner?.imageUrl ?? null).toBeNull();
    expect(h.lastText()).toContain("请选择支付方式");
  });

  test.each([
    [
      "a document that isn't an image",
      {
        document: {
          file_id: "d",
          file_unique_id: "d",
          mime_type: "application/pdf",
          file_size: 1000,
        },
      },
    ],
    [
      "an image over 1MB",
      {
        document: {
          file_id: "d",
          file_unique_id: "d",
          mime_type: "image/png",
          file_size: 2_000_000,
        },
      },
    ],
    ["a plain text answer", undefined],
  ])("%s is refused and the step is asked again", async (_label, media) => {
    await fillBanner();
    if (media) await h.media(buyer, media);
    else await h.message(buyer, "没有图片");

    expect(h.lastText()).toContain("只支持 jpg/png/webp");
    expect(await getBotDraft(db, buyer.id, Date.now())).toMatchObject({ step: "promote_image" });

    // The buyer can still finish by skipping.
    await h.message(buyer, "/skip");
    expect(h.lastText()).toContain("请选择支付方式");
  });

  test("a png document is accepted with its own content type", async () => {
    await fillBanner();
    await h.media(buyer, {
      document: { file_id: "png", file_unique_id: "p", mime_type: "image/png", file_size: 50_000 },
    });
    const orderId = Number(String(h.lastButtons()[0]?.callback_data).slice(3));
    const stored = await env.MEDIA.get(`promos/${orderId}.jpg`);
    expect(stored?.httpMetadata?.contentType).toBe("image/png");
    // Browsers load banners straight from R2, so the object has to be cacheable.
    expect(stored?.httpMetadata?.cacheControl).toBe("public, max-age=86400");
  });

  test("a failed download leaves a working banner without an image", async () => {
    await fillBanner();
    h.serveFile(() => new Response("gone", { status: 404 }));
    await h.media(buyer, photo(150_000));

    const texts = h.calls("sendMessage").map((c) => String(c.payload.text));
    expect(texts.some((text) => text.includes("图片上传失败"))).toBe(true);
    const orderId = Number(String(h.lastButtons()[0]?.callback_data).slice(3));
    expect((await getOrder(db, orderId))?.banner?.imageUrl ?? null).toBeNull();
    expect(await env.MEDIA.get(`promos/${orderId}.jpg`)).toBeNull();
  });

  test("an invalid link is refused before the image step", async () => {
    await h.message(buyer, "/promote");
    await press("pp:3");
    await h.message(buyer, banner.title);
    await h.message(buyer, banner.subtitle);
    await h.message(buyer, "http://not-https.example");
    expect(h.lastText()).toContain("https://");
    expect(await getBotDraft(db, buyer.id, Date.now())).toMatchObject({ step: "promote_href" });
  });
});

describe("buying a pin with Stars", () => {
  test("/promote → product → @username → Stars sends an XTR invoice for the order", async () => {
    await h.message(buyer, "/promote");
    expect(h.lastButtons().map((b) => b.callback_data)).toEqual(["pp:1", "pp:2", "pp:3", "pp:4"]);
    expect(h.lastButtons()[0]?.text).toContain("⭐800");

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
      prices: [{ amount: 800 }],
    });
  });

  test("pre-checkout accepts the matching pending order and rejects a wrong amount", async () => {
    const pin = await order({ productId: 1, targetUsername: "@pin_me" });
    await preCheckout(pin.id, 400);
    await preCheckout(pin.id, 800);
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

describe("hourly build safety net", () => {
  // Noon UTC: the hourly cron runs maintenance without the daily digest.
  const NOON = Date.UTC(2026, 8, 17, 12);

  test("a change left unpublished is rebuilt within the hour, a clean site is not", async () => {
    await h.scheduled(NOON, HOURLY);
    expect(h.dispatches).toEqual([]);

    // A change whose own dispatch never landed (failed token, throttled away).
    await setSiteState(db, "dirty_since", String(NOON - 40 * 60 * 1000));
    await h.scheduled(NOON, HOURLY);
    expect(h.dispatches).toHaveLength(1);
    expect(await getSiteState(db, "build_dispatched_at")).toBe(String(NOON));

    // That build is on its way: the next hourly run leaves it alone.
    h.reset();
    await h.scheduled(NOON + 20 * 60 * 1000, HOURLY);
    expect(h.dispatches).toEqual([]);
  });
});
