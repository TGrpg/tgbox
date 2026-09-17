import {
  createCryptoPayInvoice,
  parseCryptoPayUpdate,
  verifyCryptoPaySignature,
} from "@tgbox/core";
import { describe, expect, test } from "vitest";
import { setup } from "./fake.ts";

const token = "12345:AAtesttoken";

async function sign(body: string, key = token) {
  const secret = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  const hmac = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", hmac, new TextEncoder().encode(body));
  return [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const paidUpdate = {
  update_id: 1,
  update_type: "invoice_paid",
  request_date: "2026-09-17T00:00:00.000Z",
  payload: {
    invoice_id: 777,
    status: "paid",
    asset: "USDT",
    amount: "10",
    payload: "order:5",
  },
};

describe("crypto pay webhook", () => {
  test("accepts the signature of the exact raw body only", async () => {
    const body = JSON.stringify(paidUpdate);
    const signature = await sign(body);

    expect(await verifyCryptoPaySignature(token, body, signature)).toBe(true);
    expect(await verifyCryptoPaySignature(token, body, signature.toUpperCase())).toBe(true);
    expect(await verifyCryptoPaySignature(token, `${body} `, signature)).toBe(false);
    expect(await verifyCryptoPaySignature("other", body, signature)).toBe(false);
    expect(await verifyCryptoPaySignature(token, body, await sign(body, "other"))).toBe(false);
    expect(await verifyCryptoPaySignature(token, body, "not-hex")).toBe(false);
    expect(await verifyCryptoPaySignature(token, body, null)).toBe(false);
  });

  test("parses paid invoices and ignores anything else", () => {
    expect(parseCryptoPayUpdate(paidUpdate)).toEqual({
      type: "invoice_paid",
      invoiceId: "777",
      payload: "order:5",
      amount: "10",
      asset: "USDT",
    });
    expect(parseCryptoPayUpdate({ ...paidUpdate, update_type: "other" })).toBeNull();
    expect(parseCryptoPayUpdate({ update_type: "invoice_paid" })).toBeNull();
    expect(parseCryptoPayUpdate(null)).toBeNull();
  });
});

describe("crypto pay invoices", () => {
  test("creates a USDT invoice on the chosen network", async () => {
    const { ctx } = await setup();
    const requests: { url: string; headers: Headers; body: unknown }[] = [];
    const client = {
      ...ctx,
      fetch: async (url: string, init?: RequestInit) => {
        requests.push({
          url,
          headers: new Headers(init?.headers),
          body: JSON.parse(String(init?.body)),
        });
        return Response.json({
          ok: true,
          result: {
            invoice_id: 42,
            bot_invoice_url: "https://t.me/CryptoTestnetBot?start=IVabc",
            mini_app_invoice_url: "https://t.me/CryptoTestnetBot/app?startapp=invoice-IVabc",
            web_app_invoice_url: "https://testnet-app.send.tg/invoices/IVabc",
          },
        });
      },
    };

    const invoice = await createCryptoPayInvoice(client, {
      token,
      network: "testnet",
      amount: "10",
      description: "Pin 7 days",
      payload: "order:5",
      expiresIn: 3600,
    });
    expect(invoice).toEqual({
      invoiceId: "42",
      payUrl: "https://t.me/CryptoTestnetBot?start=IVabc",
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://testnet-pay.crypt.bot/api/createInvoice");
    expect(requests[0]?.headers.get("crypto-pay-api-token")).toBe(token);
    expect(requests[0]?.body).toEqual({
      currency_type: "crypto",
      asset: "USDT",
      amount: "10",
      description: "Pin 7 days",
      payload: "order:5",
      expires_in: 3600,
    });
  });

  test("throws when Crypto Pay returns an error", async () => {
    const { ctx } = await setup();
    const client = {
      ...ctx,
      fetch: async () =>
        Response.json({ ok: false, error: { code: 401, name: "UNAUTHORIZED" } }, { status: 401 }),
    };
    await expect(
      createCryptoPayInvoice(client, {
        token,
        network: "mainnet",
        amount: "10",
        description: "x",
        payload: "order:1",
        expiresIn: 3600,
      }),
    ).rejects.toThrow(/UNAUTHORIZED/);
  });
});
