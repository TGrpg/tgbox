/**
 * Pagefind runs entirely in the browser against an index served as static files, so search costs
 * no Worker request. Both the site's search dialog and the Mini App's browse screen load it here,
 * which keeps one cached module promise for the whole page.
 */

export interface PagefindData {
  url: string;
  excerpt: string;
  meta: Partial<Record<string, string>>;
  filters: Partial<Record<string, string[]>>;
}

/** The subset of the Pagefind browser API used here. */
export interface Pagefind {
  search(term: string): Promise<{ results: { data(): Promise<PagefindData> }[] }>;
}

let pagefindModule: Promise<Pagefind> | undefined;

export function loadPagefind(baseUrl: string): Promise<Pagefind> {
  pagefindModule ??= import(/* @vite-ignore */ `${baseUrl}/pagefind.js`);
  return pagefindModule;
}

/** After a failed load, forget it so the next search retries instead of reusing the rejection. */
export function resetPagefind() {
  pagefindModule = undefined;
}
