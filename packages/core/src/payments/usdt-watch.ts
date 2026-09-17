import {
  countPendingUsdtPayments,
  createUsdtPayment,
  expireUsdtPayments,
  getProduct,
  getUsdtPayment,
  listPendingUsdtPayments,
  markUsdtPaid,
} from "@tgbox/db";
import { z } from "zod";
import { audit } from "../audit.ts";
import type { CoreContext } from "../context.ts";
import { getSettings } from "../settings.ts";
import {
  matchTransfer,
  microToUsdt,
  type PendingUsdtPayment,
  pickUniqueMicro,
  USDT_TRC20_CONTRACT,
  usdtToMicro,
} from "./usdt.ts";

const MINUTE_MS = 60_000;
/** How far back the watcher looks. Comfortably longer than the longest allowed payment window. */
const LOOKBACK_MS = 3 * 60 * MINUTE_MS;
/** One page is plenty: the address only receives payments for this bot. */
const PAGE_SIZE = 50;

export type UsdtQuote = {
  address: string;
  /** The exact decimal string the buyer must send, e.g. "10.0037". */
  amount: string;
  amountMicro: number;
  expiresAt: number;
};

export type UsdtQuoteError = "disabled" | "not_configured" | "product_unavailable" | "no_amount";

/**
 * Quotes an order in USDT: the receiving address plus an amount unique to this order, which is how
 * the watcher recognises the transfer later. Re-quoting an order returns the amount it already
 * has, so a buyer who taps twice doesn't strand their first transfer.
 */
export async function quoteUsdtOrder(
  ctx: CoreContext,
  input: { orderId: number; productId: number },
): Promise<{ ok: true; quote: UsdtQuote } | { ok: false; error: UsdtQuoteError }> {
  const { payments } = await getSettings(ctx);
  if (!payments.usdtSelfEnabled) return { ok: false, error: "disabled" };
  if (payments.usdtAddress === "") return { ok: false, error: "not_configured" };

  const existing = await getUsdtPayment(ctx.db, input.orderId);
  if (existing?.status === "pending") {
    return {
      ok: true,
      quote: {
        address: existing.address,
        amount: microToUsdt(existing.amountMicro),
        amountMicro: existing.amountMicro,
        expiresAt: existing.expiresAt,
      },
    };
  }

  const product = await getProduct(ctx.db, input.productId);
  if (!product) return { ok: false, error: "product_unavailable" };
  const baseMicro = usdtToMicro(product.priceUsdt);
  if (baseMicro === 0) return { ok: false, error: "product_unavailable" };

  const taken = new Set((await listPendingUsdtPayments(ctx.db)).map((row) => row.amountMicro));
  const amountMicro = pickUniqueMicro(baseMicro, taken);
  // Every tail for this price is spoken for. Quoting a duplicate would make one transfer pay an
  // arbitrary one of the two orders, so refuse and let the buyer retry.
  if (amountMicro === null) return { ok: false, error: "no_amount" };

  const now = ctx.now();
  const stored = await createUsdtPayment(ctx.db, {
    orderId: input.orderId,
    chain: "trc20",
    amountMicro,
    address: payments.usdtAddress,
    status: "pending",
    createdAt: now,
    expiresAt: now + payments.usdtExpiryMinutes * MINUTE_MS,
  });
  if (!stored) return { ok: false, error: "no_amount" };
  return {
    ok: true,
    quote: {
      address: stored.address,
      amount: microToUsdt(stored.amountMicro),
      amountMicro: stored.amountMicro,
      expiresAt: stored.expiresAt,
    },
  };
}

/** The shape of a TRC20 transfer in TronGrid's account-transactions response. */
const TronTransfers = z.object({
  data: z
    .array(
      z.object({
        transaction_id: z.string(),
        block_timestamp: z.number(),
        to: z.string().optional(),
        value: z.string(),
        token_info: z.object({ address: z.string() }).partial().optional(),
      }),
    )
    .default([]),
});

export type UsdtWatchResult = {
  /** Transfers that paid an order. */
  matched: { orderId: number; txHash: string; amount: string }[];
  /** Incoming transfers that matched no pending order; recorded for manual follow-up. */
  unmatched: number;
  expired: number;
  subrequests: number;
};

/**
 * Reads recent incoming USDT transfers and settles the orders waiting for them. Pull-based, so it
 * is the cron rather than a webhook that confirms a payment; `settle` does the crediting so this
 * module never has to know how an order is fulfilled.
 *
 * Returns without touching the network when nothing is pending, which is the normal case — that
 * guard is what makes it cheap enough to run on every refresh tick.
 */
export async function watchUsdtPayments(
  ctx: CoreContext,
  settle: (payment: { orderId: number; txHash: string; amount: string }) => Promise<void>,
  options: { apiKey?: string | null } = {},
): Promise<UsdtWatchResult> {
  const result: UsdtWatchResult = { matched: [], unmatched: 0, expired: 0, subrequests: 0 };
  const now = ctx.now();

  const { payments } = await getSettings(ctx);
  if (!payments.usdtSelfEnabled || payments.usdtAddress === "") return result;

  const waiting = await countPendingUsdtPayments(ctx.db, now);
  result.subrequests++;
  if (waiting === 0) {
    // Still sweep up amounts whose window closed, so they can be handed out again.
    result.expired = await expireUsdtPayments(ctx.db, now);
    if (result.expired > 0) result.subrequests++;
    return result;
  }

  const pending: PendingUsdtPayment[] = await listPendingUsdtPayments(ctx.db);
  result.subrequests++;

  const url = new URL(
    `https://api.trongrid.io/v1/accounts/${payments.usdtAddress}/transactions/trc20`,
  );
  url.searchParams.set("only_to", "true");
  // Unconfirmed transfers can still be reorged away; never credit an order from one.
  url.searchParams.set("only_confirmed", "true");
  url.searchParams.set("contract_address", USDT_TRC20_CONTRACT);
  url.searchParams.set("min_block_timestamp", String(now - LOOKBACK_MS));
  url.searchParams.set("order_by", "block_timestamp,desc");
  url.searchParams.set("limit", String(PAGE_SIZE));

  let transfers: z.infer<typeof TronTransfers>["data"];
  try {
    const response = await ctx.fetch(url.toString(), {
      headers: options.apiKey ? { "TRON-PRO-API-KEY": options.apiKey } : {},
      signal: AbortSignal.timeout(8_000),
    });
    result.subrequests++;
    if (!response.ok) {
      console.error("trongrid returned", response.status);
      return result;
    }
    const parsed = TronTransfers.safeParse(await response.json());
    if (!parsed.success) {
      console.error("trongrid response did not parse");
      return result;
    }
    transfers = parsed.data.data;
  } catch (error) {
    // The chain is not going anywhere: log and let the next tick retry rather than failing the
    // whole cron invocation, which also carries the entry refresh.
    console.error("trongrid fetch failed", error);
    return result;
  }

  const settled = new Set<number>();
  for (const transfer of transfers) {
    if (transfer.token_info?.address && transfer.token_info.address !== USDT_TRC20_CONTRACT) {
      continue;
    }
    const valueMicro = Number(transfer.value);
    if (!Number.isSafeInteger(valueMicro)) continue;
    const orderId = matchTransfer(valueMicro, transfer.block_timestamp, pending);
    if (orderId === null || settled.has(orderId)) {
      if (orderId === null) {
        result.unmatched++;
        // Someone sent the wrong amount, or paid twice. Never auto-credit it; the operator can
        // refund from the audit trail.
        await audit(ctx, "system", "usdt.unmatched", `tx:${transfer.transaction_id}`, {
          amount: microToUsdt(valueMicro),
        });
      }
      continue;
    }
    // Conditional on the row still being pending, so a replayed transfer settles nothing twice.
    if (!(await markUsdtPaid(ctx.db, { orderId, txHash: transfer.transaction_id, now }))) continue;
    result.subrequests++;
    settled.add(orderId);
    const amount = microToUsdt(valueMicro);
    result.matched.push({ orderId, txHash: transfer.transaction_id, amount });
    await settle({ orderId, txHash: transfer.transaction_id, amount });
  }

  result.expired = await expireUsdtPayments(ctx.db, now);
  if (result.expired > 0) result.subrequests++;
  return result;
}
