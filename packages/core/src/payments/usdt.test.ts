import { describe, expect, test } from "vitest";
import {
  isTronAddress,
  matchTransfer,
  microToUsdt,
  type PendingUsdtPayment,
  pickUniqueMicro,
  usdtToMicro,
} from "./usdt.ts";

describe("usdtToMicro", () => {
  test.each([
    ["10", 10_000_000],
    ["9.5", 9_500_000],
    ["0.01", 10_000],
    ["0.000001", 1],
    ["1.234567", 1_234_567],
  ])("%s USDT is %i micro", (price, micro) => {
    expect(usdtToMicro(price)).toBe(micro);
  });

  test.each(["", " ", "abc", "-1", "1.2345678", "1e6", "١٠"])(
    "rejects %o rather than guessing an amount",
    (price) => {
      expect(usdtToMicro(price)).toBe(0);
    },
  );

  test("round-trips through microToUsdt", () => {
    for (const price of ["10", "9.5", "0.01", "1.234567"]) {
      expect(microToUsdt(usdtToMicro(price))).toBe(price);
    }
  });

  test("renders a unique amount at four decimals, which is what the buyer has to type", () => {
    expect(microToUsdt(10_000_000 + 3_700)).toBe("10.0037");
  });
});

describe("pickUniqueMicro", () => {
  test("adds a tail that keeps the amount within four decimal places", () => {
    const amount = pickUniqueMicro(10_000_000, new Set());
    expect(amount).not.toBeNull();
    expect(amount as number).toBeGreaterThan(10_000_000);
    // A tail of at most 0.0099, in steps of 0.0001.
    expect((amount as number) - 10_000_000).toBeLessThanOrEqual(9_900);
    expect((amount as number) % 100).toBe(0);
  });

  test("never reuses an amount another unpaid order is waiting for", () => {
    const taken = new Set<number>();
    for (let index = 0; index < 99; index++) {
      const amount = pickUniqueMicro(10_000_000, taken);
      expect(amount).not.toBeNull();
      expect(taken.has(amount as number)).toBe(false);
      taken.add(amount as number);
    }
    expect(taken.size).toBe(99);
  });

  test("returns null once every tail for that price is taken, instead of colliding", () => {
    const taken = new Set<number>();
    for (let tail = 100; tail <= 9_900; tail += 100) taken.add(10_000_000 + tail);
    expect(pickUniqueMicro(10_000_000, taken)).toBeNull();
  });

  test("a different price is unaffected by another price's taken tails", () => {
    const taken = new Set<number>();
    for (let tail = 100; tail <= 9_900; tail += 100) taken.add(10_000_000 + tail);
    expect(pickUniqueMicro(20_000_000, taken)).not.toBeNull();
  });

  test("does not hand out amounts in a predictable order", () => {
    const first = () => pickUniqueMicro(10_000_000, new Set(), () => 0.999);
    const ascending = pickUniqueMicro(10_000_000, new Set(), () => 0);
    expect(first()).not.toBe(ascending);
  });
});

describe("matchTransfer", () => {
  const NOW = Date.UTC(2026, 8, 18, 12);
  const pending: PendingUsdtPayment[] = [
    { orderId: 7, amountMicro: 10_003_700, createdAt: NOW, expiresAt: NOW + 30 * 60_000 },
    { orderId: 9, amountMicro: 20_000_500, createdAt: NOW, expiresAt: NOW + 30 * 60_000 },
  ];

  test("an exact amount inside the window pays that order", () => {
    expect(matchTransfer(10_003_700, NOW + 60_000, pending)).toBe(7);
    expect(matchTransfer(20_000_500, NOW + 60_000, pending)).toBe(9);
  });

  test("one micro-USDT short is not a payment", () => {
    expect(matchTransfer(10_003_699, NOW + 60_000, pending)).toBeNull();
    expect(matchTransfer(10_003_701, NOW + 60_000, pending)).toBeNull();
  });

  test("the round base price does not pay an order that was assigned a tail", () => {
    expect(matchTransfer(10_000_000, NOW + 60_000, pending)).toBeNull();
  });

  test("a transfer from before the order existed cannot pay it", () => {
    // The address is reused forever, so an old transfer may well carry today's unique amount.
    expect(matchTransfer(10_003_700, NOW - 60_000, pending)).toBeNull();
  });

  test("a transfer after the window closed cannot pay it", () => {
    expect(matchTransfer(10_003_700, NOW + 31 * 60_000, pending)).toBeNull();
  });

  test("no pending orders means nothing matches", () => {
    expect(matchTransfer(10_003_700, NOW, [])).toBeNull();
  });
});

describe("isTronAddress", () => {
  test("accepts a real-looking TRC20 address", () => {
    expect(isTronAddress("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t")).toBe(true);
  });

  test.each([
    "",
    "not-an-address",
    "0x1234567890123456789012345678901234567890",
    "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6",
    "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6tt",
    "TR7NHqjeKQxGTCi8q0ZY4pL8otSzgjLj6t",
  ])("rejects %o so funds cannot be sent nowhere", (address) => {
    expect(isTronAddress(address)).toBe(false);
  });
});
