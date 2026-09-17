import type { PromoView } from "@tgbox/shared";
import { describe, expect, test } from "vitest";
import { promos as house } from "../data/promos.ts";
import { mergePromos } from "./promos.ts";

function paid(id: string, href = `https://t.me/sponsor${id}`): PromoView {
  return { id, title: `Sponsor ${id}`, subtitle: "Join us", href, sponsored: true };
}

describe("mergePromos", () => {
  test("without paid banners the house promos fill the slots, localized", () => {
    const zh = mergePromos([], house, "zh", 5);
    expect(zh.map((card) => card.id)).toEqual(house.slice(0, 5).map((promo) => promo.id));
    expect(zh.every((card) => !card.sponsored)).toBe(true);
    expect(zh[0]).toMatchObject({ href: "/enroll/", badge: "收录", external: false });
    expect(mergePromos([], house, "en", 5)[0]).toMatchObject({
      href: "/en/enroll/",
      badge: "Submit",
    });
  });

  test("paid banners come first, house promos fill the rest up to the limit", () => {
    const cards = mergePromos([paid("7"), paid("9")], house, "zh", 5);
    expect(cards.map((card) => card.id)).toEqual(["7", "9", ...house.slice(0, 3).map((p) => p.id)]);
    expect(cards[0]).toMatchObject({
      sponsored: true,
      badge: null,
      title: "Sponsor 7",
      href: "https://t.me/sponsor7",
      external: true,
      icon: "ad",
    });
  });

  test("the detail page limit keeps only the first three", () => {
    const cards = mergePromos([paid("1"), paid("2"), paid("3"), paid("4")], house, "en", 3);
    expect(cards.map((card) => card.id)).toEqual(["1", "2", "3"]);
  });

  test("paid banners get a house gradient picked deterministically from the id", () => {
    const palette = house.map((promo) => promo.background);
    const [first] = mergePromos([paid("42")], house, "zh", 1);
    const [again] = mergePromos([paid("42")], house, "en", 1);
    expect(palette).toContain(first?.background);
    expect(again?.background).toBe(first?.background);
    const picked = new Set(
      Array.from(
        { length: 20 },
        (_, index) => mergePromos([paid(String(index))], house, "zh", 1)[0]?.background,
      ),
    );
    expect(picked.size).toBeGreaterThan(1);
  });

  test("paid banners with a non-http link are dropped", () => {
    const cards = mergePromos(
      [paid("1", "javascript:alert(1)"), paid("2", "tg://resolve?domain=x"), paid("3")],
      [],
      "zh",
      5,
    );
    expect(cards.map((card) => card.id)).toEqual(["3"]);
    expect(cards[0]?.background).toMatch(/gradient/);
  });
});
