import type { PostView } from "@tgbox/shared";
import { describe, expect, test } from "vitest";
import { postReach } from "./post-reach.ts";

const post = (id: number, views: number | null): PostView => ({
  id,
  date: "2026-09-01T00:00:00+00:00",
  text: "",
  views,
});

describe("postReach", () => {
  test("averages the posts that show a view count, and relates it to the subscribers", () => {
    const posts = [post(1, 1000), post(2, 2000), post(3, null), post(4, 3000)];
    expect(postReach(posts, 40_000)).toEqual({ avgViews: 2000, rate: 0.05 });
  });

  test("too few counted posts say nothing", () => {
    expect(postReach([post(1, 500), post(2, 700), post(3, null)], 1000)).toBeNull();
  });

  test("no rate without a subscriber count", () => {
    const posts = [post(1, 10), post(2, 20), post(3, 30)];
    expect(postReach(posts, null)).toEqual({ avgViews: 20, rate: null });
    expect(postReach(posts, 0)).toEqual({ avgViews: 20, rate: null });
  });
});
