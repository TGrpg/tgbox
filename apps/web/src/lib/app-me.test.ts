import type { AppOrder, AppSubmission } from "@tgbox/shared";
import { describe, expect, test } from "vitest";
import { daysLeft, ME_FRESH_MS, meCacheUse, meCounts } from "./app-me.ts";

const DAY = 24 * 60 * 60 * 1000;

const submission = (status: AppSubmission["status"]): AppSubmission => ({
  id: 1,
  username: "demo",
  kind: "channel",
  status,
  rejectReason: null,
  createdAt: 0,
  reviewedAt: null,
});

const order = (status: AppOrder["status"]): AppOrder => ({
  id: 1,
  kind: "highlight",
  productName: "高亮 7 天",
  status,
  amount: "5",
  currency: "USDT",
  createdAt: 0,
  startsAt: null,
  endsAt: null,
  targetUsername: null,
  clicks: 0,
});

describe("meCounts", () => {
  test("is all zeros for a new user", () => {
    expect(meCounts({ submissions: [], orders: [] })).toEqual({
      listed: 0,
      reviewing: 0,
      running: 0,
      unpaid: 0,
    });
  });

  test("counts listed and in-review submissions, running and unpaid orders", () => {
    const counts = meCounts({
      submissions: (["approved", "approved", "pending", "rejected"] as const).map(submission),
      orders: (["active", "pending", "pending", "expired", "refunded"] as const).map(order),
    });
    expect(counts).toEqual({ listed: 2, reviewing: 1, running: 1, unpaid: 2 });
  });
});

describe("daysLeft", () => {
  test("rounds a partial day up", () => {
    expect(daysLeft(DAY * 3, DAY * 3 - 1)).toBe(1);
    expect(daysLeft(DAY * 3, 0)).toBe(3);
    expect(daysLeft(DAY * 3 + 1, 0)).toBe(4);
  });

  test("is zero once the end has passed", () => {
    expect(daysLeft(DAY, DAY)).toBe(0);
    expect(daysLeft(DAY, DAY * 2)).toBe(0);
  });
});

describe("meCacheUse", () => {
  const now = 1_000_000;

  test("uses a copy cached moments ago by the same user", () => {
    expect(meCacheUse({ userId: 7, at: now - 1_000 }, 7, now)).toBe("fresh");
  });

  test("fetches again once the copy is older than the fresh window", () => {
    expect(meCacheUse({ userId: 7, at: now - ME_FRESH_MS }, 7, now)).toBe("stale");
  });

  test("never shows another account's copy", () => {
    expect(meCacheUse({ userId: 7, at: now }, 8, now)).toBe("none");
  });

  test("has nothing to use when nothing is cached", () => {
    expect(meCacheUse(null, 7, now)).toBe("none");
  });
});
