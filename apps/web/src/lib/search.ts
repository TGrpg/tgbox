/** Pagefind excerpts are escaped text with `<mark>` highlights; drop anything else before rendering as HTML. */
export function safeExcerpt(excerpt: string) {
  return excerpt.replace(/<(\/?)mark\b[^>]*>|<[^>]*>/gi, (_, close?: string) =>
    close === undefined ? "" : `<${close}mark>`,
  );
}

/** Fallback when on-site search misses: the same query on Google/Bing, limited to this site. */
export function externalSearchUrls(query: string, siteUrl: string) {
  const q = `site:${new URL(siteUrl).host} ${query}`.trim();
  const params = new URLSearchParams({ q }).toString();
  return {
    google: `https://www.google.com/search?${params}`,
    bing: `https://www.bing.com/search?${params}`,
  };
}
