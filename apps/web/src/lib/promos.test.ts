import type { PromoView } from "@tgbox/shared";
import { describe, expect, test } from "vitest";
import { promoBackgrounds, promoSlots, promoteUrl } from "./promos.ts";

function paid(id: string, href = `https://t.me/sponsor${id}`): PromoView {
  return { id, title: `Sponsor ${id}`, subtitle: "Join us", href, imageUrl: null, sponsored: true };
}

function withImage(id: string, imageUrl: string | null): PromoView {
  return { ...paid(id), imageUrl };
}

function background(promo: PromoView): string {
  const [card] = promoSlots([promo], 1, 1, true);
  return card?.type === "paid" ? card.background : "";
}

const types = (slots: ReturnType<typeof promoSlots>) => slots.map((slot) => slot.type);

describe("promoSlots", () => {
  test.each([
    { name: "home", slots: 5, emptySlots: 2 },
    { name: "detail", slots: 3, emptySlots: 1 },
  ])(
    "without paid banners the $name page shows only a few placeholders",
    ({ slots, emptySlots }) => {
      const cards = promoSlots([], slots, emptySlots, true);
      expect(types(cards)).toEqual(Array(emptySlots).fill("placeholder"));
      expect(new Set(cards.map((card) => card.id)).size).toBe(emptySlots);
    },
  );

  test.each([
    { name: "home", slots: 5, emptySlots: 2 },
    { name: "detail", slots: 3, emptySlots: 1 },
  ])("with ad slots off the $name page renders nothing at all", ({ slots, emptySlots }) => {
    // The whole sponsor block keys off this being empty, so "off" has to mean zero cards, not
    // fewer cards: anything else leaves a heading advertising space nobody bought.
    expect(promoSlots([], slots, emptySlots, false)).toEqual([]);
  });

  test("ad slots off still shows the banners someone paid for", () => {
    expect(types(promoSlots([paid("7"), paid("9")], 5, 2, false))).toEqual(["paid", "paid"]);
  });

  test("paid banners come first and placeholders fill the remaining slots", () => {
    const cards = promoSlots([paid("7"), paid("9")], 5, 2, true);
    expect(types(cards)).toEqual(["paid", "paid", "placeholder", "placeholder", "placeholder"]);
    expect(cards[0]).toMatchObject({
      type: "paid",
      id: "7",
      title: "Sponsor 7",
      subtitle: "Join us",
      href: "https://t.me/sponsor7",
    });
  });

  test("more paid banners than slots keeps only the first ones", () => {
    const cards = promoSlots([paid("1"), paid("2"), paid("3"), paid("4")], 3, 1, true);
    expect(cards.map((card) => card.id)).toEqual(["1", "2", "3"]);
  });

  test("paid banners get a gradient picked deterministically from the id", () => {
    expect(promoBackgrounds).toContain(background(paid("42")));
    expect(background(paid("42"))).toBe(background(paid("42")));
    const picked = new Set(
      Array.from({ length: 20 }, (_, index) => background(paid(String(index)))),
    );
    expect(picked.size).toBeGreaterThan(1);
  });

  test("an uploaded image covers the card, with the gradient left behind it as a fallback", () => {
    const url = "https://media.tgbox.cc/promos/42.jpg";
    const [card] = promoSlots([withImage("42", url)], 1, 1, true);
    expect(card).toMatchObject({ type: "paid", imageUrl: url });
    expect(background(withImage("42", url))).toBe(
      `url("${url}") center/cover no-repeat, ${background(paid("42"))}`,
    );
  });

  test.each([
    { name: "missing", imageUrl: null },
    { name: "plain http", imageUrl: "http://media.tgbox.cc/promos/1.jpg" },
    { name: "a CSS-breaking quote", imageUrl: 'https://media.tgbox.cc/a".jpg' },
    { name: "a url() injection", imageUrl: "https://x/a.jpg);background:url(evil" },
  ])("an image that is $name leaves the gradient alone", ({ imageUrl }) => {
    const [card] = promoSlots([withImage("42", imageUrl)], 1, 1, true);
    expect(card).toMatchObject({ type: "paid", imageUrl: null });
    expect(background(withImage("42", imageUrl))).toBe(background(paid("42")));
  });

  test("paid banners with a non-http link are dropped and don't count as paid", () => {
    const unsafe = [paid("1", "javascript:alert(1)"), paid("2", "tg://resolve?domain=x")];
    expect(types(promoSlots(unsafe, 5, 2, true))).toEqual(["placeholder", "placeholder"]);
    expect(promoSlots([...unsafe, paid("3")], 5, 2, true).map((card) => card.id)).toEqual([
      "3",
      "slot-2",
      "slot-3",
      "slot-4",
      "slot-5",
    ]);
  });

  test("the promote deep link opens the bot's promote flow", () => {
    expect(promoteUrl("tgboxccbot")).toBe("https://t.me/tgboxccbot?start=promote");
  });
});
