/**
 * Self-hosted USDT (TRC20) collection: one receiving address, and a unique amount per order used
 * as the order's fingerprint. A cron reads the address's incoming transfers and matches them back
 * to orders by exact amount. Nothing here ever touches a private key — the funds land directly in
 * the operator's own wallet and this code only reads the chain.
 *
 * Every amount is an integer count of micro-USDT (1 USDT = 1e6). TronGrid returns transfer values
 * as integer strings in the same unit, so both sides compare as integers and no float rounding can
 * decide whether an order was paid.
 */

/** USDT has 6 decimals on every chain we care about. */
const MICRO = 1_000_000;

/**
 * Smallest and largest tail added to the base price to make an amount unique, in micro-USDT
 * (0.0001–0.0099 USDT). The step keeps the payable amount at 4 decimal places, which every wallet
 * renders and lets a payer type it back by hand if they need to.
 */
const TAIL_MIN = 100;
const TAIL_MAX = 9_900;
const TAIL_STEP = 100;

/** Decimal price string (`products.price_usdt`, e.g. "10" or "9.5") → micro-USDT. */
export function usdtToMicro(price: string): number {
  if (!/^\d{1,9}(\.\d{1,6})?$/.test(price.trim())) return 0;
  const [whole = "0", fraction = ""] = price.trim().split(".");
  return Number(whole) * MICRO + Number(fraction.padEnd(6, "0"));
}

/** micro-USDT → the exact decimal string the buyer must send, e.g. `10.0037`. */
export function microToUsdt(micro: number): string {
  const whole = Math.floor(micro / MICRO);
  const fraction = String(micro % MICRO)
    .padStart(6, "0")
    .replace(/0+$/, "");
  return fraction === "" ? String(whole) : `${whole}.${fraction}`;
}

/**
 * Picks an amount that no other unpaid order is currently waiting for, by adding a random tail to
 * the base price. Tries the tails in a shuffled order so the next amount isn't guessable, and
 * returns null when every tail for this price is taken — at which point the caller should ask the
 * buyer to retry rather than risk two orders sharing a fingerprint.
 */
export function pickUniqueMicro(
  baseMicro: number,
  taken: ReadonlySet<number>,
  random: () => number = Math.random,
): number | null {
  const tails: number[] = [];
  for (let tail = TAIL_MIN; tail <= TAIL_MAX; tail += TAIL_STEP) tails.push(tail);
  for (let index = tails.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [tails[index], tails[swap]] = [tails[swap] as number, tails[index] as number];
  }
  for (const tail of tails) {
    const candidate = baseMicro + tail;
    if (!taken.has(candidate)) return candidate;
  }
  return null;
}

/** An unpaid order waiting for its exact amount. Timestamps are unix epoch milliseconds. */
export type PendingUsdtPayment = {
  orderId: number;
  amountMicro: number;
  createdAt: number;
  expiresAt: number;
};

/**
 * Matches one incoming transfer to the order that was waiting for it.
 *
 * The amount alone is not enough: the same address is reused forever, so a transfer from weeks ago
 * could carry an amount that a new order has since been assigned. The transfer must therefore also
 * fall inside the order's own payment window. Together with the caller's `only_confirmed=true`,
 * that is three independent reasons a stale transfer cannot pay for a fresh order.
 */
export function matchTransfer(
  valueMicro: number,
  transferAt: number,
  pending: readonly PendingUsdtPayment[],
): number | null {
  for (const payment of pending) {
    if (payment.amountMicro !== valueMicro) continue;
    if (transferAt < payment.createdAt || transferAt > payment.expiresAt) continue;
    return payment.orderId;
  }
  return null;
}

/** USDT-TRC20 contract. Transfers of anything else on the address are ignored. */
export const USDT_TRC20_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

/** Rejects anything that is not a plausible TRON base58 address, before it can be saved. */
export function isTronAddress(address: string): boolean {
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address);
}
