import {
  createUsdtPayment,
  expireUsdtPayments,
  getProduct,
  getUsdtPayment,
  knownUsdtTransfers,
  listPendingUsdtPayments,
  markUsdtPaid,
  recordUnmatchedUsdtTransfers,
} from "@tgbox/db";
import { z } from "zod";
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
/** Keep expired quotes reserved while an on-time transfer obtains chain confirmations. */
const CONFIRMATION_GRACE_MS = 15 * MINUTE_MS;
/** TronGrid's maximum page size. */
const PAGE_SIZE = 50;
/** Pages per tick across all addresses: a busy wallet can't eat the shared cron budget. */
const MAX_PAGES = 3;

export type UsdtQuote = {
  address: string;
  /** The exact decimal string the buyer must send, e.g. "10.0037". */
  amount: string;
  amountMicro: number;
  expiresAt: number;
};

export type UsdtQuoteError =
  | "disabled"
  | "not_configured"
  | "product_unavailable"
  | "no_amount"
  | "order_expired";

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
  if (existing) {
    if (existing.status !== "pending" || existing.expiresAt <= ctx.now()) {
      return { ok: false, error: "order_expired" };
    }
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
  const now = ctx.now();
  // A concurrent quote may win after our read. The unique index arbitrates; retry a bounded
  // number of tails so contention cannot exhaust the request's D1 budget.
  for (let attempt = 0; attempt < 5; attempt++) {
    const amountMicro = pickUniqueMicro(baseMicro, taken);
    if (amountMicro === null) break;
    const stored = await createUsdtPayment(ctx.db, {
      orderId: input.orderId,
      chain: "trc20",
      amountMicro,
      address: payments.usdtAddress,
      status: "pending",
      createdAt: now,
      expiresAt: now + payments.usdtExpiryMinutes * MINUTE_MS,
    });
    if (stored) {
      if (stored.status !== "pending" || stored.expiresAt <= ctx.now()) {
        return { ok: false, error: "order_expired" };
      }
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
    taken.add(amountMicro);
  }
  return { ok: false, error: "no_amount" };
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
  meta: z
    .object({
      fingerprint: z.string().optional(),
      links: z.object({ next: z.string().optional() }).partial().optional(),
    })
    .partial()
    .optional(),
});

type TronTransfer = z.infer<typeof TronTransfers>["data"][number];

export type UsdtWatchResult = {
  /** Transfers that paid an order. */
  matched: { orderId: number; txHash: string; amount: string }[];
  /** Incoming transfers seen for the first time that matched no pending order. */
  unmatched: number;
  expired: number;
  /** Addresses whose payment windows were only partly read this tick (page cap or an error). */
  incomplete: string[];
};

/** The page TronGrid says comes next, from either place it puts the cursor. */
function nextFingerprint(meta: z.infer<typeof TronTransfers>["meta"]) {
  if (meta?.fingerprint) return meta.fingerprint;
  if (!meta?.links?.next) return null;
  try {
    return new URL(meta.links.next).searchParams.get("fingerprint");
  } catch {
    return null;
  }
}

/**
 * Every transfer into `address` across the pending windows, newest first, up to `pages` pages.
 * `complete` is false when a page failed or more were left, so the caller won't expire a window
 * whose payment may be on a page it didn't read.
 */
async function readTransfers(
  ctx: CoreContext,
  address: string,
  window: { from: number; to: number },
  pages: number,
  apiKey: string | null,
) {
  const url = new URL(`https://api.trongrid.io/v1/accounts/${address}/transactions/trc20`);
  url.searchParams.set("only_to", "true");
  // Unconfirmed transfers can still be reorged away; never credit an order from one.
  url.searchParams.set("only_confirmed", "true");
  url.searchParams.set("contract_address", USDT_TRC20_CONTRACT);
  url.searchParams.set("min_block_timestamp", String(window.from));
  url.searchParams.set("max_block_timestamp", String(window.to));
  url.searchParams.set("order_by", "block_timestamp,desc");
  url.searchParams.set("limit", String(PAGE_SIZE));

  const transfers: TronTransfer[] = [];
  let fetched = 0;
  while (fetched < pages) {
    try {
      fetched++;
      const response = await ctx.fetch(url.toString(), {
        headers: apiKey ? { "TRON-PRO-API-KEY": apiKey } : {},
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) {
        console.error("trongrid returned", response.status);
        return { transfers, fetched, complete: false };
      }
      const parsed = TronTransfers.safeParse(await response.json());
      if (!parsed.success) {
        console.error("trongrid response did not parse");
        return { transfers, fetched, complete: false };
      }
      transfers.push(...parsed.data.data);
      const next = nextFingerprint(parsed.data.meta);
      if (next === null || parsed.data.data.length < PAGE_SIZE) {
        return { transfers, fetched, complete: true };
      }
      url.searchParams.set("fingerprint", next);
    } catch (error) {
      // The chain is not going anywhere: log and let the next tick retry rather than failing the
      // whole cron invocation, which also carries the entry refresh.
      console.error("trongrid fetch failed", error);
      return { transfers, fetched, complete: false };
    }
  }
  return { transfers, fetched, complete: false };
}

/**
 * Reads recent incoming USDT transfers and settles the orders waiting for them. Pull-based, so it
 * is the cron rather than a webhook that confirms a payment; `settle` does the crediting so this
 * module never has to know how an order is fulfilled.
 *
 * Each quote is watched at the address it was given, even after the operator changes the address
 * or turns self-hosted USDT off: the buyer may still be paying. Returns without touching the
 * network when nothing is pending, which is the normal case — that guard (one D1 read) is what
 * makes it cheap enough to run on every refresh tick. `maxPages` caps the TronGrid pages per tick
 * across all addresses.
 */
export async function watchUsdtPayments(
  ctx: CoreContext,
  settle: (payment: { orderId: number; txHash: string; amount: string }) => Promise<void>,
  options: { apiKey?: () => Promise<string | null>; maxPages?: number } = {},
): Promise<UsdtWatchResult> {
  const result: UsdtWatchResult = { matched: [], unmatched: 0, expired: 0, incomplete: [] };
  const now = ctx.now();

  const pending = await listPendingUsdtPayments(ctx.db);
  if (pending.length === 0) return result;

  const apiKey = (await options.apiKey?.()) ?? null;
  // Oldest quote first, so a page cap never starves the address with the earliest deadline.
  const byAddress = new Map<string, PendingUsdtPayment[]>();
  for (const payment of [...pending].sort((a, b) => a.createdAt - b.createdAt)) {
    byAddress.set(payment.address, [...(byAddress.get(payment.address) ?? []), payment]);
  }
  const addresses = [...byAddress.keys()];
  let pagesLeft = options.maxPages ?? MAX_PAGES;
  const complete: string[] = [];
  const unmatched = new Map<string, { txHash: string; amount: string; address: string }>();
  const settled = new Set<number>();

  for (const [index, address] of addresses.entries()) {
    const waiting = byAddress.get(address) ?? [];
    // Every address still to come keeps one page of the cap; this one may use the rest.
    const pages = pagesLeft - (addresses.length - 1 - index);
    if (pages <= 0) {
      result.incomplete.push(address);
      continue;
    }
    const window = {
      from: Math.min(...waiting.map((payment) => payment.createdAt)),
      to: Math.max(...waiting.map((payment) => payment.expiresAt)),
    };
    const read = await readTransfers(ctx, address, window, pages, apiKey);
    pagesLeft -= read.fetched;
    if (read.complete) complete.push(address);
    else result.incomplete.push(address);

    for (const transfer of read.transfers) {
      if (transfer.token_info?.address && transfer.token_info.address !== USDT_TRC20_CONTRACT) {
        continue;
      }
      if (transfer.to !== undefined && transfer.to !== address) continue;
      const valueMicro = Number(transfer.value);
      if (!Number.isSafeInteger(valueMicro)) continue;
      const amount = microToUsdt(valueMicro);
      const orderId = matchTransfer(valueMicro, transfer.block_timestamp, waiting);
      if (orderId === null) {
        // Someone sent the wrong amount, paid twice, or the transfer already paid an order and
        // left the pending list. Never auto-credit it; new ones are recorded below.
        unmatched.set(transfer.transaction_id, {
          txHash: transfer.transaction_id,
          amount,
          address,
        });
        continue;
      }
      if (settled.has(orderId)) continue;
      // Settle before marking the transfer paid: crediting the order is idempotent per tx hash, so
      // when it fails the row stays pending and the next tick settles the same transfer again.
      try {
        await settle({ orderId, txHash: transfer.transaction_id, amount });
      } catch (error) {
        console.error("usdt settle failed", orderId, transfer.transaction_id, error);
        continue;
      }
      settled.add(orderId);
      result.matched.push({ orderId, txHash: transfer.transaction_id, amount });
      await markUsdtPaid(ctx.db, { orderId, txHash: transfer.transaction_id, now });
    }
  }

  // The same transfers come back every tick while an order waits; each is recorded only once.
  if (unmatched.size > 0) {
    const known = await knownUsdtTransfers(ctx.db, [...unmatched.keys()]);
    const fresh = [...unmatched.values()].filter((transfer) => !known.has(transfer.txHash));
    await recordUnmatchedUsdtTransfers(ctx.db, fresh, now);
    result.unmatched = fresh.length;
  }

  result.expired = await expireUsdtPayments(ctx.db, now - CONFIRMATION_GRACE_MS, complete);
  return result;
}
