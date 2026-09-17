/** Rankings page: switch lists (tabs, `#weekly` style hashes) and filter rows by kind, all client-side. */
const root = document.querySelector<HTMLElement>("[data-rankings]");

if (root) {
  const tabs = [...root.querySelectorAll<HTMLButtonElement>("[data-rank-tab]")];
  const panels = [...root.querySelectorAll<HTMLElement>("[data-rank-panel]")];
  const kindButtons = [...root.querySelectorAll<HTMLButtonElement>("[data-rank-kind]")];

  const selectTab = (key: string, focus = false) => {
    const tab = tabs.find((item) => item.dataset.rankTab === key);
    if (!tab) return;
    for (const item of tabs) {
      const selected = item === tab;
      item.setAttribute("aria-selected", String(selected));
      item.tabIndex = selected ? 0 : -1;
    }
    for (const panel of panels)
      panel.toggleAttribute("data-active", panel.dataset.rankPanel === key);
    if (focus) tab.focus();
  };

  const filterKind = (kind: string) => {
    for (const button of kindButtons) {
      button.setAttribute("aria-pressed", String(button.dataset.rankKind === kind));
    }
    for (const panel of panels) {
      const items = [...panel.querySelectorAll<HTMLElement>("[data-rank-item]")];
      let rank = 0;
      for (const item of items) {
        const visible = kind === "all" || item.dataset.kind === kind;
        item.hidden = !visible;
        if (!visible) continue;
        rank += 1;
        const label = item.querySelector("[data-rank]");
        if (!label) continue;
        label.textContent = String(rank);
        if (rank <= 3) label.setAttribute("data-top", String(rank));
        else label.removeAttribute("data-top");
      }
      const empty = panel.querySelector<HTMLElement>("[data-rank-empty]");
      // A list with no rows at all keeps its server-rendered message ("collecting data").
      if (!empty || items.length === 0) continue;
      empty.textContent = empty.dataset.kindEmpty ?? "";
      empty.hidden = rank > 0;
    }
  };

  root.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const tab = event.target.closest<HTMLElement>("[data-rank-tab]");
    if (tab?.dataset.rankTab) {
      selectTab(tab.dataset.rankTab);
      history.replaceState(null, "", `#${tab.dataset.rankTab}`);
    }
    const kind = event.target.closest<HTMLElement>("[data-rank-kind]");
    if (kind?.dataset.rankKind) filterKind(kind.dataset.rankKind);
  });

  root.addEventListener("keydown", (event) => {
    const current = event.target instanceof HTMLButtonElement ? tabs.indexOf(event.target) : -1;
    if (current === -1 || (event.key !== "ArrowRight" && event.key !== "ArrowLeft")) return;
    event.preventDefault();
    const step = event.key === "ArrowRight" ? 1 : -1;
    const next = tabs[(current + step + tabs.length) % tabs.length]?.dataset.rankTab;
    if (next) selectTab(next, true);
  });

  selectTab(location.hash.slice(1));
}
