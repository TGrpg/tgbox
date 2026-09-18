/** Browser-safe helpers for the home page "hot" columns (no Node imports: bundled into the page script). */

/** Rows shown per hot column; "shuffle" steps through the pool this many at a time. */
export const HOT_PAGE_SIZE = 10;

export interface HotItem {
  u: string;
  t: string;
  v: boolean;
  a: string | null;
  m: number | null;
  /** promoted (any tier: they all look the same) */
  p: boolean;
}

/** Page `index` of the pool, wrapping around once the pool is exhausted. */
export function hotPage<TItem>(pool: TItem[], index: number, size = HOT_PAGE_SIZE): TItem[] {
  const pages = Math.ceil(pool.length / size);
  if (pages === 0) return [];
  const start = (index % pages) * size;
  return pool.slice(start, start + size);
}

function isHotItem(value: unknown): value is HotItem {
  if (typeof value !== "object" || value === null) return false;
  const item: Partial<Record<keyof HotItem, unknown>> = value;
  return (
    typeof item.u === "string" &&
    typeof item.t === "string" &&
    typeof item.v === "boolean" &&
    (item.a === null || typeof item.a === "string") &&
    (item.m === null || typeof item.m === "number") &&
    typeof item.p === "boolean"
  );
}

/** Keeps only well-formed items of a fetched pool. */
export function parseHotPool(value: unknown): HotItem[] {
  return Array.isArray(value) ? value.filter(isHotItem) : [];
}

// Same palette and pick as Avatar.astro, so re-rendered rows keep their placeholder color.
const tints = [
  "from-[#ff885e] to-[#ff516a]",
  "from-[#ffcd6a] to-[#ffa85c]",
  "from-[#82b1ff] to-[#665fff]",
  "from-[#a0de7e] to-[#54cb68]",
  "from-[#53edd6] to-[#28c9b7]",
  "from-[#72d5fd] to-[#2a9ef1]",
  "from-[#e0a2f3] to-[#d669ed]",
];

export function avatarTint(title: string): string[] {
  const sum = [...title].reduce((total, char) => total + (char.codePointAt(0) ?? 0), 0);
  return (tints[sum % tints.length] ?? "").split(" ");
}
