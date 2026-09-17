import type { PaymentSettings } from "@tgbox/shared";
import { z } from "zod";
import type { CoreContext } from "../context.ts";

const apiBase = {
  mainnet: "https://pay.crypt.bot/api",
  testnet: "https://testnet-pay.crypt.bot/api",
};

const CreateInvoiceResponse = z.union([
  z.object({
    ok: z.literal(true),
    result: z.object({
      invoice_id: z.number().int(),
      bot_invoice_url: z.string(),
      mini_app_invoice_url: z.string().optional(),
      web_app_invoice_url: z.string().optional(),
    }),
  }),
  z.object({
    ok: z.literal(false),
    error: z.object({ code: z.number().optional(), name: z.string().optional() }).optional(),
  }),
]);

/** Creates a USDT invoice. Throws when Crypto Pay rejects the request. */
export async function createCryptoPayInvoice(
  ctx: CoreContext,
  input: {
    token: string;
    network: PaymentSettings["cryptoPayNetwork"];
    /** Decimal string, e.g. "10" */
    amount: string;
    description: string;
    /** Echoed back in the webhook, e.g. `order:<id>` */
    payload: string;
    /** Seconds */
    expiresIn: number;
  },
) {
  const res = await ctx.fetch(`${apiBase[input.network]}/createInvoice`, {
    method: "POST",
    headers: { "content-type": "application/json", "Crypto-Pay-API-Token": input.token },
    body: JSON.stringify({
      currency_type: "crypto",
      asset: "USDT",
      amount: input.amount,
      description: input.description,
      payload: input.payload,
      expires_in: input.expiresIn,
    }),
  });
  const body = CreateInvoiceResponse.safeParse(await res.json().catch(() => null));
  if (!body.success) throw new Error(`crypto pay createInvoice: unexpected response ${res.status}`);
  if (!body.data.ok) {
    throw new Error(`crypto pay createInvoice failed: ${body.data.error?.name ?? res.status}`);
  }
  return {
    invoiceId: String(body.data.result.invoice_id),
    payUrl: body.data.result.bot_invoice_url,
  };
}

function hexToBytes(hex: string) {
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) return null;
  return Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
}

/**
 * Webhook check: `crypto-pay-api-signature` is hex HMAC-SHA256 of the raw body keyed with
 * SHA-256(token). `crypto.subtle.verify` compares in constant time.
 */
export async function verifyCryptoPaySignature(
  token: string,
  rawBody: string,
  signatureHex: string | null,
) {
  const signature = signatureHex ? hexToBytes(signatureHex) : null;
  if (!signature) return false;
  const secret = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const key = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify("HMAC", key, signature, new TextEncoder().encode(rawBody));
}

const InvoicePaidUpdate = z.object({
  update_type: z.literal("invoice_paid"),
  payload: z.object({
    invoice_id: z.number().int(),
    status: z.literal("paid"),
    amount: z.string(),
    asset: z.string().optional(),
    payload: z.string().optional(),
  }),
});

/** The paid invoice from a webhook body, or null for other/malformed updates. */
export function parseCryptoPayUpdate(json: unknown) {
  const update = InvoicePaidUpdate.safeParse(json);
  if (!update.success) return null;
  const invoice = update.data.payload;
  return {
    type: "invoice_paid" as const,
    invoiceId: String(invoice.invoice_id),
    payload: invoice.payload ?? null,
    amount: invoice.amount,
    asset: invoice.asset ?? null,
  };
}
