import type { ClientDirective } from "astro";

/**
 * `client:search` — hydrate the search island only when the visitor reaches for it: hovering,
 * focusing or pressing a `[data-search-trigger]`, Ctrl/⌘+K, or a `?q=` link. Loading React on
 * idle put ~150KB (compressed) on every page view, most of which never search. A press or shortcut
 * that lands before the island is ready is kept in `data-search-pending` so the dialog still opens.
 */
const searchDirective: ClientDirective = (load) => {
  const root = document.documentElement;
  let started = false;
  const start = async () => {
    if (started) return;
    started = true;
    document.removeEventListener("pointerover", onWarm, true);
    document.removeEventListener("focusin", onWarm, true);
    document.removeEventListener("click", onPress, true);
    document.removeEventListener("keydown", onKey, true);
    const hydrate = await load();
    await hydrate();
  };
  const isTrigger = (event: Event) =>
    event.target instanceof Element && event.target.closest("[data-search-trigger]") !== null;
  const onWarm = (event: Event) => {
    if (isTrigger(event)) void start();
  };
  const onPress = (event: Event) => {
    if (!isTrigger(event)) return;
    root.dataset.searchPending = "";
    void start();
  };
  const onKey = (event: KeyboardEvent) => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k") return;
    event.preventDefault();
    root.dataset.searchPending = "";
    void start();
  };
  document.addEventListener("pointerover", onWarm, true);
  document.addEventListener("focusin", onWarm, true);
  document.addEventListener("click", onPress, true);
  document.addEventListener("keydown", onKey, true);
  if (new URLSearchParams(location.search).has("q")) void start();
};

export default searchDirective;
