/**
 * Page numbers to render: first, last, current ±1; `null` marks an ellipsis.
 * Short ranges are shown in full; a gap of exactly one page is filled instead of an ellipsis.
 */
export function pageWindow(current: number, total: number): (number | null)[] {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const shown = new Set([1, total, current - 1, current, current + 1]);
  const pages = [...shown].filter((page) => page >= 1 && page <= total).sort((a, b) => a - b);
  const result: (number | null)[] = [];
  let previous = 0;
  for (const page of pages) {
    if (page - previous === 2) result.push(previous + 1);
    else if (page - previous > 2) result.push(null);
    result.push(page);
    previous = page;
  }
  return result;
}
