import { expect, test } from "vitest";
import { newProductDraft, parseProductDraft, toDraft } from "./product-draft.ts";

const valid = {
  ...newProductDraft,
  nameZh: "置顶 7 天",
  nameEn: "Pin · 7 days",
  priceStars: "500",
  priceUsdt: "10",
};

test("a complete draft parses into product fields", () => {
  expect(parseProductDraft(valid)).toEqual({
    ok: true,
    value: {
      kind: "pin",
      nameZh: "置顶 7 天",
      nameEn: "Pin · 7 days",
      days: 7,
      priceStars: 500,
      priceUsdt: "10",
      slots: 5,
      active: true,
      sort: 0,
    },
  });
});

test.each([
  ["no Chinese name", { nameZh: " " }],
  ["0 days", { days: "0" }],
  ["fractional stars", { priceStars: "9.5" }],
  ["three USDT decimals", { priceUsdt: "1.005" }],
  ["a zero USDT price", { priceUsdt: "0" }],
  ["101 slots", { slots: "101" }],
])("rejects %s", (_name, patch) => {
  expect(parseProductDraft({ ...valid, ...patch }).ok).toBe(false);
});

test("an existing product round-trips through the draft", () => {
  const product = {
    id: 3,
    kind: "banner" as const,
    nameZh: "横幅",
    nameEn: "Banner",
    days: 30,
    priceStars: 3000,
    priceUsdt: "60",
    slots: 5,
    active: false,
    sort: 4,
  };
  const { id: _id, ...fields } = product;
  expect(parseProductDraft(toDraft(product))).toEqual({ ok: true, value: fields });
});
