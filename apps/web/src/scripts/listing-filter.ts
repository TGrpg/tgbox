/**
 * Listing pages: narrow the rendered entries by detected language and/or tag. The choice lives in
 * the URL fragment (`#lang=zh&tag=free`), which crawlers neither follow nor index — these filters
 * have no search demand of their own and must not create a second crawlable copy of a listing.
 * Without JS nothing is hidden and the page keeps every entry it was built with.
 */
const facets = [
  { key: "lang", chips: [...document.querySelectorAll<HTMLAnchorElement>("[data-lang-chip]")] },
  { key: "tag", chips: [...document.querySelectorAll<HTMLAnchorElement>("[data-tag-chip]")] },
];
const chipValue = (chip: HTMLAnchorElement) => chip.dataset.langChip ?? chip.dataset.tagChip;

if (facets.some((facet) => facet.chips.length > 0)) {
  const items = [...document.querySelectorAll<HTMLElement>("[data-entry-lang]")];
  const sections = [...document.querySelectorAll<HTMLElement>("[data-lang-section]")];
  const empty = document.querySelector<HTMLElement>("[data-filter-empty]");
  // An overview shows only the top of each category; its "view all" links take the filter along.
  const carriers = [...document.querySelectorAll<HTMLAnchorElement>("[data-carry-filter]")].map(
    (link) => ({ link, base: link.getAttribute("href") ?? "" }),
  );

  const apply = () => {
    const params = new URLSearchParams(location.hash.slice(1));
    const chosen = facets.map(({ key, chips }) => {
      const wanted = params.get(key) ?? "all";
      // An unknown or stale value would empty the page, so it falls back to showing everything.
      const value = chips.some((chip) => chipValue(chip) === wanted) ? wanted : "all";
      for (const chip of chips) {
        if (chipValue(chip) === value) chip.setAttribute("aria-current", "true");
        else chip.removeAttribute("aria-current");
      }
      return value;
    });
    const [lang, tag] = chosen;
    for (const item of items) {
      item.hidden =
        (lang !== "all" && item.dataset.entryLang !== lang) ||
        (tag !== "all" && !(item.dataset.entryTags ?? "").split(" ").includes(tag ?? ""));
    }
    for (const section of sections) {
      section.hidden = section.querySelector("[data-entry-lang]:not([hidden])") === null;
    }
    // Each chip alone always leaves an entry; a language and a tag together may not.
    if (empty) empty.hidden = items.some((item) => !item.hidden);
    for (const { link, base } of carriers) link.setAttribute("href", base + location.hash);
  };

  // A chip sets its own facet and keeps the other one, so language and tag combine.
  for (const { key, chips } of facets) {
    for (const chip of chips) {
      chip.addEventListener("click", (event) => {
        event.preventDefault();
        const params = new URLSearchParams(location.hash.slice(1));
        const value = chipValue(chip) ?? "all";
        if (value === "all") params.delete(key);
        else params.set(key, value);
        const hash = params.toString();
        // Setting an empty hash would jump to the top; drop the fragment without scrolling instead.
        if (hash) location.hash = hash;
        else {
          history.pushState(null, "", location.pathname + location.search);
          apply();
        }
      });
    }
  }

  addEventListener("hashchange", apply);
  apply();
}
