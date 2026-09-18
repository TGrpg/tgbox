/**
 * Listing pages: show only the entries written in one detected language. The choice lives in the
 * URL fragment (`#lang=zh`), which crawlers neither follow nor index — this filter has no search
 * demand of its own and must not create a second crawlable copy of `/channel/`. Without JS nothing
 * is hidden and the page keeps every entry it was built with.
 */
const chips = [...document.querySelectorAll<HTMLAnchorElement>("[data-lang-chip]")];

if (chips.length > 0) {
  const items = [...document.querySelectorAll<HTMLElement>("[data-entry-lang]")];
  const sections = [...document.querySelectorAll<HTMLElement>("[data-lang-section]")];

  const apply = () => {
    const wanted = new URLSearchParams(location.hash.slice(1)).get("lang") ?? "all";
    // An unknown or stale code would empty the page, so it falls back to showing everything.
    const lang = chips.some((chip) => chip.dataset.langChip === wanted) ? wanted : "all";
    for (const chip of chips) {
      if (chip.dataset.langChip === lang) chip.setAttribute("aria-current", "true");
      else chip.removeAttribute("aria-current");
    }
    for (const item of items) item.hidden = lang !== "all" && item.dataset.entryLang !== lang;
    for (const section of sections) {
      section.hidden = section.querySelector("[data-entry-lang]:not([hidden])") === null;
    }
  };

  addEventListener("hashchange", apply);
  apply();
}
