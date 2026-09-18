import type { ProductKind } from "@tgbox/shared";

type Product = {
  id?: number;
  kind: ProductKind;
  nameZh: string;
  nameEn: string;
  days: number;
  priceStars: number;
  priceUsdt: string;
  active: boolean;
  sort: number;
};

/** Editable form state: numbers stay strings while typing. */
export type ProductDraft = {
  kind: ProductKind;
  nameZh: string;
  nameEn: string;
  days: string;
  priceStars: string;
  priceUsdt: string;
  active: boolean;
  sort: string;
};

export const newProductDraft: ProductDraft = {
  kind: "pin",
  nameZh: "",
  nameEn: "",
  days: "7",
  priceStars: "",
  priceUsdt: "",
  active: true,
  sort: "0",
};

export const toDraft = (product: Product): ProductDraft => ({
  kind: product.kind,
  nameZh: product.nameZh,
  nameEn: product.nameEn,
  days: String(product.days),
  priceStars: String(product.priceStars),
  priceUsdt: product.priceUsdt,
  active: product.active,
  sort: String(product.sort),
});

const int = (value: string, min: number, max: number) => {
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  const number = Number(trimmed);
  return number >= min && number <= max ? number : null;
};

/** Mirrors core's product rules so the form can say what's wrong before saving. */
export function parseProductDraft(
  draft: ProductDraft,
): { ok: true; value: Omit<Product, "id"> } | { ok: false; error: string } {
  const nameZh = draft.nameZh.trim();
  const nameEn = draft.nameEn.trim();
  if (!nameZh || nameZh.length > 40) return { ok: false, error: "中文名必填，最多 40 字" };
  if (!nameEn || nameEn.length > 60) return { ok: false, error: "英文名必填，最多 60 字" };
  const days = int(draft.days, 1, 365);
  if (days === null) return { ok: false, error: "天数需在 1–365 之间" };
  const priceStars = int(draft.priceStars, 1, 1_000_000);
  if (priceStars === null) return { ok: false, error: "Stars 价格需为 1–1000000 的整数" };
  const priceUsdt = draft.priceUsdt.trim();
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(priceUsdt) || Number(priceUsdt) <= 0) {
    return { ok: false, error: "USDT 价格需大于 0，最多两位小数" };
  }
  const sort = int(draft.sort, -1_000_000, 1_000_000);
  if (sort === null) return { ok: false, error: "排序需为整数" };
  return {
    ok: true,
    value: {
      kind: draft.kind,
      nameZh,
      nameEn,
      days,
      priceStars,
      priceUsdt,
      active: draft.active,
      sort,
    },
  };
}
