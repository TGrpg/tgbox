import type { PromoView } from "@tgbox/shared";
import { describe, expect, test } from "vitest";
import { promoBackgrounds, promoSlots, promoteUrl } from "./promos.ts";

function paid(id: string, href = `https://t.me/sponsor${id}`): PromoView {
  return { id, title: `Sponsor ${id}`, subtitle: "Join us", href, sponsored: true };
}

const types = (slots: ReturnType<typeof promoSlots>) => slots.map((slot) => slot.type);

describe("promoSlots", () => {
  test.each([
    { name: "home", slots: 5, emptySlots: 2 },
    { name: "detail", slots: 3, emptySlots: 1 },
  ])(
    "without paid banners the $name page shows only a few placeholders",
    ({ slots, emptySlots }) => {
      const cards = promoSlots([], slots, emptySlots);
      expect(types(cards)).toEqual(Array(emptySlots).fill("placeholder"));
      expect(new Set(cards.map((card) => card.id)).size).toBe(emptySlots);
    },
  );

  test("paid banners come first and placeholders fill the remaining slots", () => {
    const cards = promoSlots([paid("7"), paid("9")], 5, 2);
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
    const cards = promoSlots([paid("1"), paid("2"), paid("3"), paid("4")], 3, 1);
    expect(cards.map((card) => card.id)).toEqual(["1", "2", "3"]);
  });

  test("paid banners get a gradient picked deterministically from the id", () => {
    const background = (id: string) => {
      const [card] = promoSlots([paid(id)], 1, 1);
      return card?.type === "paid" ? card.background : undefined;
    };
    expect(promoBackgrounds).toContain(background("42"));
    expect(background("42")).toBe(background("42"));
    const picked = new Set(Array.from({ length: 20 }, (_, index) => background(String(index))));
    expect(picked.size).toBeGreaterThan(1);
  });

  test("paid banners with a non-http link are dropped and don't count as paid", () => {
    const unsafe = [paid("1", "javascript:alert(1)"), paid("2", "tg://resolve?domain=x")];
    expect(types(promoSlots(unsafe, 5, 2))).toEqual(["placeholder", "placeholder"]);
    expect(promoSlots([...unsafe, paid("3")], 5, 2).map((card) => card.id)).toEqual([
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
