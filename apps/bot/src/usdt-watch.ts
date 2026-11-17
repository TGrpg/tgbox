import { getCredential, watchUsdtPayments } from "@tgbox/core";
import { getOrder } from "@tgbox/db";
import type { App } from "./bot/index.ts";
import { recordPayment } from "./bot/payments.ts";

/**
 * Settles USDT transfers that arrived since the last tick. Rides the refresh cron rather than
 * taking a trigger of its own: every scheduled invocation costs a request, and with no unpaid
 * orders this costs a single D1 read and returns.
 */
export async function runUsdtWatch(app: App) {
  const result = await watchUsdtPayments(
    app.core,
    async ({ orderId, txHash, amount }) => {
      const order = await getOrder(app.db, orderId);
      if (!order) return;
      // Unlike Stars, there is no pre-checkout hook: minutes pass between the buyer being quoted
      // and the transfer confirming, so the buyer is told and the payment is recorded either way —
      // `markOrderPaid` only auto-activates a pin, and a full slot leaves it for an admin to start
      // or refund.
      await recordPayment(app, {
        orderId,
        provider: "usdt",
        chargeId: txHash,
        amount,
        currency: "USDT",
        buyerId: order.tgUserId,
        locale: null,
      });
    },
    {
      // Read only when an order is waiting, so an idle tick stays one D1 read.
      apiKey: async () =>
        app.env.SETTINGS_KEY
          ? await getCredential(app.core, "trongrid_key").catch(() => null)
          : null,
    },
  );

  if (
    result.matched.length > 0 ||
    result.unmatched > 0 ||
    result.expired > 0 ||
    result.incomplete.length > 0
  ) {
    console.log("usdt", JSON.stringify(result));
  }
  return result;
}
