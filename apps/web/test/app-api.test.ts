import type { APIContext } from "astro";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { env } from "./cloudflare-workers-stub.ts";
import { initData } from "./init-data.ts";

/**
 * The `/api/app/*` routes, driven the way the Mini App drives them: a signed launch string in a
 * header and a JSON body. D1 is mocked (as in promo-redirect.test.ts) and so is t.me and the Bot
 * API, but `@tgbox/core` runs for real on top of the mocks — the point of most of these tests is
 * that the routes reuse the shared rules and take the user from the signature, not from the body.
 */

// Bare `vi.fn()`s: every default lives in `beforeEach`, so no inferred return type gets in the way.
const db = vi.hoisted(() => ({
  createDb: vi.fn(),
  getBlacklistEntry: vi.fn(),
  loadAppOverview: vi.fn(),
  listSettingsRows: vi.fn(),
  getEntryByUsername: vi.fn(),
  findPendingSubmission: vi.fn(),
  countSubmissionsSince: vi.fn(),
  listCategories: vi.fn(),
  listTags: vi.fn(),
  createSubmission: vi.fn(),
  insertAuditLog: vi.fn(),
  getProduct: vi.fn(),
  listProducts: vi.fn(),
  countActivePromotions: vi.fn(),
  countPaidOrders: vi.fn(),
  earliestPromotionEnd: vi.fn(),
  createPendingOrder: vi.fn(),
  getOrder: vi.fn(),
  setOrderBanner: vi.fn(),
  setUserLocale: vi.fn(),
  getUserLocale: vi.fn(),
  getUsdtPayment: vi.fn(),
  listPendingUsdtPayments: vi.fn(),
  createUsdtPayment: vi.fn(),
}));
vi.mock("@tgbox/db", () => db);

const telegram = vi.hoisted(() => ({ fetchEntrySnapshot: vi.fn() }));
vi.mock("@tgbox/telegram", async (importOriginal) => ({
  // `verifyInitData` stays real: the signature is what these tests are about.
  ...(await importOriginal<typeof import("@tgbox/telegram")>()),
  fetchEntrySnapshot: telegram.fetchEntrySnapshot,
}));

const { GET: me } = await import("../src/pages/api/app/me.ts");
const { POST: submit } = await import("../src/pages/api/app/submit.ts");
const { GET: preview } = await import("../src/pages/api/app/preview.ts");
const { POST: createOrder } = await import("../src/pages/api/app/orders.ts");
const { GET: orderStatus } = await import("../src/pages/api/app/orders/[id].ts");
const { POST: pay } = await import("../src/pages/api/app/orders/[id]/pay.ts");
const { POST: prefs } = await import("../src/pages/api/app/prefs.ts");
const { POST: upload } = await import("../src/pages/api/app/upload.ts");

const USER = 900;
const OTHER_USER = 901;

type Handler = (context: APIContext) => Response | Promise<Response>;

type CallOptions = {
  user?: number;
  /** Omitted entirely = no header at all. */
  header?: string | null;
  body?: unknown;
  form?: FormData;
  params?: Record<string, string>;
  query?: string;
};

function call(handler: Handler, path: string, options: CallOptions = {}) {
  const headers = new Headers();
  const header =
    options.header === undefined ? initData({ id: options.user ?? USER }) : options.header;
  if (header !== null) headers.set("X-Telegram-Init-Data", header);
  const url = new URL(`https://tgbox.cc${path}${options.query ?? ""}`);
  const init: RequestInit = { headers };
  if (options.form) init.body = options.form;
  else if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
    headers.set("content-type", "application/json");
  }
  if (init.body !== undefined) init.method = "POST";
  const request = new Request(url, init);
  return handler({ request, url, params: options.params ?? {} } as unknown as APIContext);
}

const overview = {
  submissions: [
    {
      id: 51,
      username: "devnotes",
      kind: "channel",
      status: "pending",
      rejectReason: null,
      createdAt: 10,
      reviewedAt: null,
    },
  ],
  orders: [
    {
      id: 77,
      productId: 1,
      kind: "pin",
      status: "active",
      amount: "100",
      currency: "XTR",
      createdAt: 20,
      startsAt: 30,
      endsAt: 40,
      targetUsername: "devnotes",
    },
  ],
  clicksByOrder: new Map([[77, 12]]),
  settingsRows: [],
  submittedToday: 2,
  locale: "en" as const,
  productNames: new Map([[1, { id: 1, nameZh: "置顶 7 天", nameEn: "Pin 7 days" }]]),
};

const product = {
  id: 1,
  kind: "pin" as const,
  nameZh: "置顶 7 天",
  nameEn: "Pin 7 days",
  days: 7,
  priceStars: 100,
  priceUsdt: "10",
  slots: 3,
  active: true,
  sort: 0,
};

const pendingOrder = {
  id: 77,
  tgUserId: USER,
  productId: 1,
  kind: "pin" as const,
  days: 7,
  targetUsername: "devnotes",
  banner: null,
  status: "pending" as const,
  provider: null,
  amount: null,
  currency: null,
  invoiceId: null,
  chargeId: null,
  note: null,
  createdAt: 20,
  paidAt: null,
  startsAt: null,
  endsAt: null,
  remindedAt: null,
};

const liveChannel = {
  liveness: "active",
  kind: "channel",
  profile: {
    title: "Dev Notes",
    description: "Notes",
    avatarUrl: "https://cdn.telegram.org/a.jpg",
    verified: false,
    members: 1234,
    online: null,
    monthlyUsers: null,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  db.createDb.mockReturnValue({});
  db.getBlacklistEntry.mockResolvedValue(undefined);
  db.loadAppOverview.mockResolvedValue(overview);
  db.listSettingsRows.mockResolvedValue([]);
  db.getEntryByUsername.mockResolvedValue(undefined);
  db.findPendingSubmission.mockResolvedValue(undefined);
  db.countSubmissionsSince.mockResolvedValue(0);
  db.listCategories.mockResolvedValue([{ id: 3, kind: "channel", slug: "news" }]);
  db.listTags.mockResolvedValue([{ id: 7 }, { id: 8 }]);
  db.createSubmission.mockResolvedValue(51);
  db.getProduct.mockResolvedValue(product);
  db.listProducts.mockResolvedValue([product]);
  db.countActivePromotions.mockResolvedValue(0);
  db.countPaidOrders.mockResolvedValue(0);
  db.earliestPromotionEnd.mockResolvedValue(null);
  db.createPendingOrder.mockResolvedValue({ ...pendingOrder });
  db.getOrder.mockResolvedValue({ ...pendingOrder });
  db.getUserLocale.mockResolvedValue("en");
  db.getUsdtPayment.mockResolvedValue(undefined);
  db.listPendingUsdtPayments.mockResolvedValue([]);
  telegram.fetchEntrySnapshot.mockResolvedValue(liveChannel);
  env.MEDIA = { put: vi.fn(async () => {}) };
});

const endpoints: [name: string, run: (options?: CallOptions) => Promise<Response>][] = [
  ["GET /api/app/me", (o) => Promise.resolve(call(me, "/api/app/me", o)) as Promise<Response>],
  [
    "POST /api/app/submit",
    (o) =>
      Promise.resolve(
        call(submit, "/api/app/submit", {
          body: { username: "devnotes", categoryId: 3, tagIds: [7] },
          ...o,
        }),
      ) as Promise<Response>,
  ],
  [
    "GET /api/app/preview",
    (o) =>
      Promise.resolve(
        call(preview, "/api/app/preview", { query: "?username=devnotes", ...o }),
      ) as Promise<Response>,
  ],
  [
    "POST /api/app/orders",
    (o) =>
      Promise.resolve(
        call(createOrder, "/api/app/orders", {
          body: { productId: 1, targetUsername: "@devnotes" },
          ...o,
        }),
      ) as Promise<Response>,
  ],
  [
    "GET /api/app/orders/:id",
    (o) =>
      Promise.resolve(
        call(orderStatus, "/api/app/orders/77", { params: { id: "77" }, ...o }),
      ) as Promise<Response>,
  ],
  [
    "POST /api/app/orders/:id/pay",
    (o) =>
      Promise.resolve(
        call(pay, "/api/app/orders/77/pay", {
          params: { id: "77" },
          body: { method: "usdt" },
          ...o,
        }),
      ) as Promise<Response>,
  ],
  [
    "POST /api/app/prefs",
    (o) =>
      Promise.resolve(
        call(prefs, "/api/app/prefs", { body: { locale: "en" }, ...o }),
      ) as Promise<Response>,
  ],
  [
    "POST /api/app/upload",
    (o) => {
      const form = new FormData();
      form.set("orderId", "77");
      form.set("image", new File(["x"], "banner.jpg", { type: "image/jpeg" }));
      return Promise.resolve(call(upload, "/api/app/upload", { form, ...o })) as Promise<Response>;
    },
  ],
];

describe("authentication", () => {
  test.each(endpoints)("%s is 401 without a launch string", async (_name, run) => {
    const response = await run({ header: null });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(db.getBlacklistEntry).not.toHaveBeenCalled();
  });

  test.each(endpoints)("%s is 401 for a forged launch string", async (_name, run) => {
    const response = await run({ header: initData({ id: USER }, { token: "999:other" }) });

    expect(response.status).toBe(401);
  });

  test.each(endpoints)("%s is 403 for a blacklisted user", async (_name, run) => {
    db.getBlacklistEntry.mockResolvedValue({ type: "user", value: String(USER) });

    const response = await run();

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "banned" });
    expect(db.getBlacklistEntry).toHaveBeenCalledWith(expect.anything(), "user", String(USER));
  });

  test.each(endpoints)("%s rejects a launch string older than a day", async (_name, run) => {
    const response = await run({
      header: initData({ id: USER }, { authDateMs: Date.now() - 25 * 60 * 60 * 1000 }),
    });

    expect(response.status).toBe(401);
  });
});

describe("GET /api/app/me", () => {
  test("answers with the caller's own submissions, orders and limits in one batch", async () => {
    const response = await call(me, "/api/app/me");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      user: { id: USER, locale: "en" },
      submissions: overview.submissions,
      orders: [
        {
          id: 77,
          kind: "pin",
          productName: "Pin 7 days",
          status: "active",
          amount: "100",
          currency: "XTR",
          createdAt: 20,
          startsAt: 30,
          endsAt: 40,
          targetUsername: "devnotes",
          clicks: 12,
        },
      ],
      limits: { submitDailyLimit: 5, submittedToday: 2, submissionsOpen: true },
    });
    expect(db.loadAppOverview).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      expect.objectContaining({ tgUserId: USER }),
    );
  });

  test("reads the overview for the signed-in user, whatever the query says", async () => {
    await call(me, "/api/app/me", { query: `?userId=${OTHER_USER}` });

    expect(db.loadAppOverview).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tgUserId: USER }),
    );
  });
});

describe("POST /api/app/submit", () => {
  const body = { username: "@devnotes", categoryId: 3, tagIds: [7] };

  test("records the submission for the verified user", async () => {
    const response = await call(submit, "/api/app/submit", { body });

    expect(await response.json()).toEqual({ ok: true, submissionId: 51 });
    expect(db.createSubmission).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tgUserId: USER,
        username: "devnotes",
        kind: "channel",
        categoryId: 3,
        tagIds: [7],
      }),
    );
  });

  test("ignores a user id in the body", async () => {
    await call(submit, "/api/app/submit", { body: { ...body, tgUserId: OTHER_USER } });

    expect(db.createSubmission).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tgUserId: USER }),
    );
  });

  test("refuses an already listed username with the bot's own rule", async () => {
    db.getEntryByUsername.mockResolvedValue({ id: 1, username: "devnotes" });

    const response = await call(submit, "/api/app/submit", { body });

    expect(await response.json()).toEqual({ ok: false, error: "already_listed" });
    expect(db.createSubmission).not.toHaveBeenCalled();
  });

  test("refuses once the daily limit is reached", async () => {
    db.countSubmissionsSince.mockResolvedValue(5);

    expect(await (await call(submit, "/api/app/submit", { body })).json()).toEqual({
      ok: false,
      error: "daily_limit",
    });
  });

  test("refuses while submissions are closed", async () => {
    db.listSettingsRows.mockResolvedValue([
      { key: "bot", value: JSON.stringify({ submissionsOpen: false }) },
    ]);

    expect(await (await call(submit, "/api/app/submit", { body })).json()).toEqual({
      ok: false,
      error: "closed",
    });
  });

  test("refuses a blacklisted username", async () => {
    db.getBlacklistEntry.mockImplementation(async (_db: unknown, type: string) =>
      type === "username" ? { type, value: "devnotes" } : undefined,
    );

    expect(await (await call(submit, "/api/app/submit", { body })).json()).toEqual({
      ok: false,
      error: "banned",
    });
  });

  test.each([
    ["a malformed body", { username: "devnotes" }],
    ["an unknown category", { ...body, categoryId: 99 }],
    ["an unknown tag", { ...body, tagIds: [7, 99] }],
  ])("refuses %s as invalid", async (_name, sent) => {
    expect(await (await call(submit, "/api/app/submit", { body: sent })).json()).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(db.createSubmission).not.toHaveBeenCalled();
  });
});

describe("GET /api/app/preview", () => {
  test("returns what t.me says about the username", async () => {
    const response = await call(preview, "/api/app/preview", { query: "?username=devnotes" });

    expect(await response.json()).toEqual({
      ok: true,
      preview: {
        username: "devnotes",
        kind: "channel",
        title: "Dev Notes",
        description: "Notes",
        members: 1234,
        avatarUrl: "https://cdn.telegram.org/a.jpg",
      },
    });
  });

  test("a username that is not a channel, group or bot is not found", async () => {
    telegram.fetchEntrySnapshot.mockResolvedValue({
      liveness: "active",
      kind: "user",
      profile: {},
    });

    expect(
      await (await call(preview, "/api/app/preview", { query: "?username=durov" })).json(),
    ).toEqual({ ok: false, error: "not_found" });
  });

  test("a malformed username never reaches t.me", async () => {
    const response = await call(preview, "/api/app/preview", {
      query: "?username=https://t.me/+x",
    });

    expect(await response.json()).toEqual({ ok: false, error: "invalid" });
    expect(telegram.fetchEntrySnapshot).not.toHaveBeenCalled();
  });

  test("one user cannot hammer t.me", async () => {
    const user = 5150;
    const responses = await Promise.all(
      Array.from({ length: 12 }, () =>
        call(preview, "/api/app/preview", { user, query: "?username=devnotes" }),
      ),
    );

    expect(responses.filter((response) => response.status === 429)).not.toHaveLength(0);
    expect(telegram.fetchEntrySnapshot.mock.calls.length).toBeLessThanOrEqual(10);
  });
});

describe("POST /api/app/orders", () => {
  test("creates the order for the verified buyer, ignoring a buyer in the body", async () => {
    db.getEntryByUsername.mockResolvedValue({ username: "devnotes", status: "approved" });

    const response = await call(createOrder, "/api/app/orders", {
      body: { productId: 1, targetUsername: "@devnotes", tgUserId: OTHER_USER },
    });

    expect(await response.json()).toEqual({ ok: true, orderId: 77 });
    expect(db.createPendingOrder).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tgUserId: USER, productId: 1, targetUsername: "devnotes" }),
    );
  });

  test("reports a sold-out kind with the moment a slot frees up", async () => {
    db.getEntryByUsername.mockResolvedValue({ username: "devnotes", status: "approved" });
    db.countActivePromotions.mockResolvedValue(3);
    db.earliestPromotionEnd.mockResolvedValue(1_700_000_000_000);

    const response = await call(createOrder, "/api/app/orders", {
      body: { productId: 1, targetUsername: "@devnotes" },
    });

    expect(await response.json()).toEqual({
      ok: false,
      error: "no_slots",
      nextFreeAt: 1_700_000_000_000,
    });
  });

  test("refuses a target that is not listed", async () => {
    db.getEntryByUsername.mockResolvedValue(undefined);

    expect(
      await (
        await call(createOrder, "/api/app/orders", {
          body: { productId: 1, targetUsername: "@nobody" },
        })
      ).json(),
    ).toEqual({ ok: false, error: "target_not_listed" });
  });
});

describe("GET /api/app/orders/:id", () => {
  test("reports the status of the caller's own order", async () => {
    db.getOrder.mockResolvedValue({ ...pendingOrder, status: "paid", paidAt: 99 });

    const response = await call(orderStatus, "/api/app/orders/77", { params: { id: "77" } });

    expect(await response.json()).toEqual({ status: "paid", paidAt: 99 });
  });

  test("someone else's order is not found", async () => {
    db.getOrder.mockResolvedValue({ ...pendingOrder, tgUserId: OTHER_USER });

    const response = await call(orderStatus, "/api/app/orders/77", { params: { id: "77" } });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: "not_found" });
  });
});

describe("POST /api/app/orders/:id/pay", () => {
  const usdtSettings = [
    {
      key: "payments",
      value: JSON.stringify({
        usdtSelfEnabled: true,
        usdtAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
      }),
    },
  ];

  test("quotes USDT with an amount unique to the order", async () => {
    db.listSettingsRows.mockResolvedValue(usdtSettings);
    db.getUsdtPayment.mockResolvedValue(undefined);
    db.createUsdtPayment.mockResolvedValue({
      orderId: 77,
      address: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
      amountMicro: 10_000_137,
      expiresAt: 1_800_000,
      status: "pending",
    });

    const response = await call(pay, "/api/app/orders/77/pay", {
      params: { id: "77" },
      body: { method: "usdt" },
    });

    expect(await response.json()).toEqual({
      ok: true,
      method: "usdt",
      address: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
      amount: "10.000137",
      expiresAt: 1_800_000,
    });
  });

  test("returns a Stars invoice link the app can open", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ ok: true, result: "https://t.me/$invoice" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await call(pay, "/api/app/orders/77/pay", {
      params: { id: "77" },
      body: { method: "stars" },
    });

    expect(await response.json()).toEqual({
      ok: true,
      method: "stars",
      invoiceLink: "https://t.me/$invoice",
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/createInvoiceLink");
    expect(JSON.parse(String(init.body))).toMatchObject({
      currency: "XTR",
      payload: "order:77",
      prices: [{ label: "Pin 7 days", amount: 100 }],
    });
  });

  test("cannot pay for someone else's order", async () => {
    db.getOrder.mockResolvedValue({ ...pendingOrder, tgUserId: OTHER_USER });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await call(pay, "/api/app/orders/77/pay", {
      params: { id: "77" },
      body: { method: "stars" },
    });

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("an order that is no longer pending cannot be paid twice", async () => {
    db.getOrder.mockResolvedValue({ ...pendingOrder, status: "paid" });

    const response = await call(pay, "/api/app/orders/77/pay", {
      params: { id: "77" },
      body: { method: "usdt" },
    });

    expect(await response.json()).toEqual({ ok: false, error: "order_expired" });
    expect(db.createUsdtPayment).not.toHaveBeenCalled();
  });
});

describe("POST /api/app/prefs", () => {
  test("stores the language against the verified user", async () => {
    const response = await call(prefs, "/api/app/prefs", {
      body: { locale: "en", tgUserId: OTHER_USER },
    });

    expect(await response.json()).toEqual({ ok: true });
    expect(db.setUserLocale).toHaveBeenCalledWith(
      expect.anything(),
      USER,
      "en",
      expect.any(Number),
    );
  });

  test("refuses a language that is not one of ours", async () => {
    const response = await call(prefs, "/api/app/prefs", { body: { locale: "de" } });

    expect(await response.json()).toEqual({ ok: false, error: "invalid" });
    expect(db.setUserLocale).not.toHaveBeenCalled();
  });
});

describe("POST /api/app/upload", () => {
  const bannerOrder = {
    ...pendingOrder,
    kind: "banner" as const,
    targetUsername: null,
    banner: { title: "Rocket", subtitle: "Fast nodes", href: "https://t.me/rocketvpn" },
  };

  const form = (fields: { orderId?: string; type?: string; bytes?: number }) => {
    const data = new FormData();
    if (fields.orderId !== undefined) data.set("orderId", fields.orderId);
    data.set(
      "image",
      new File([new Uint8Array(fields.bytes ?? 8)], "banner.jpg", {
        type: fields.type ?? "image/jpeg",
      }),
    );
    return data;
  };

  test("stores the image under the order id and attaches it to the banner", async () => {
    db.getOrder.mockResolvedValue(bannerOrder);

    const response = await call(upload, "/api/app/upload", { form: form({ orderId: "77" }) });

    expect(await response.json()).toEqual({
      ok: true,
      imageUrl: "https://media.test/promos/77.jpg",
    });
    expect(env.MEDIA.put).toHaveBeenCalledWith(
      "promos/77.jpg",
      expect.anything(),
      expect.objectContaining({
        httpMetadata: { contentType: "image/jpeg", cacheControl: "public, max-age=86400" },
      }),
    );
    expect(db.setOrderBanner).toHaveBeenCalledWith(
      expect.anything(),
      77,
      expect.objectContaining({ imageUrl: "https://media.test/promos/77.jpg" }),
    );
  });

  test("cannot upload to someone else's order", async () => {
    db.getOrder.mockResolvedValue({ ...bannerOrder, tgUserId: OTHER_USER });

    const response = await call(upload, "/api/app/upload", { form: form({ orderId: "77" }) });

    expect(response.status).toBe(404);
    expect(env.MEDIA.put).not.toHaveBeenCalled();
  });

  test.each([
    ["a file that is not an image", { orderId: "77", type: "application/pdf" }],
    ["a file over 5 MB", { orderId: "77", bytes: 5 * 1024 * 1024 + 1 }],
  ])("refuses %s", async (_name, fields) => {
    db.getOrder.mockResolvedValue(bannerOrder);

    const response = await call(upload, "/api/app/upload", { form: form(fields) });

    expect(response.status).toBe(400);
    expect(env.MEDIA.put).not.toHaveBeenCalled();
  });
});
