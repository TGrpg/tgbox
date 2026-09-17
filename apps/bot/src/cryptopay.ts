import { getCredential, parseCryptoPayUpdate, verifyCryptoPaySignature } from "@tgbox/core";
import type { App } from "./bot/index.ts";
import { parseOrderPayload, recordPayment } from "./bot/payments.ts";

/** `POST /cryptopay/webhook`: signed `invoice_paid` updates from Crypto Pay. */
export async function handleCryptoPayWebhook(app: App, request: Request) {
  const rawBody = await request.text();
  const token = await getCredential(app.core, "cryptopay_token").catch((error: unknown) => {
    console.error("crypto pay token unavailable", error);
    return null;
  });
  if (!token) return new Response("Not configured", { status: 503 });
  const signature = request.headers.get("crypto-pay-api-signature");
  if (!(await verifyCryptoPaySignature(token, rawBody, signature))) {
    return new Response("Unauthorized", { status: 401 });
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  // Other update types and foreign invoices are acknowledged so Crypto Pay stops retrying.
  const invoice = parseCryptoPayUpdate(json);
  const orderId = invoice ? parseOrderPayload(invoice.payload) : null;
  if (!invoice || orderId === null) return new Response("OK");
  if (invoice.asset !== null && invoice.asset !== "USDT") {
    console.error("crypto pay invoice in unexpected asset", invoice);
  }

  await recordPayment(app, {
    orderId,
    provider: "cryptopay",
    chargeId: invoice.invoiceId,
    amount: invoice.amount,
    currency: "USDT",
    buyerId: null,
    locale: null,
  });
  return new Response("OK");
}
