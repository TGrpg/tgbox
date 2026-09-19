/** Home page "shuffle" buttons: cycle each hot column through its static JSON pool with a staggered swap. */
import { animate } from "motion/mini";
import { avatarTint, HOT_PAGE_SIZE, type HotItem, hotPage, parseHotPool } from "@/lib/home-hot.ts";
import { durations, easeOut, springs, springTransition } from "@/lib/motion-presets.ts";

const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const gentle = springTransition(springs.gentle);
const STAGGER = 0.025;
// Page URLs live under the locale's prefix; only zh-hant has its own (converted) data files.
const { lang } = document.documentElement;
const detailPrefix = lang === "zh-Hant" ? "/zh-hant" : lang.startsWith("zh") ? "" : "/en";
const dataPrefix = lang === "zh-Hant" ? "/zh-hant" : "";
const compact = new Intl.NumberFormat(document.documentElement.lang, {
  notation: "compact",
  maximumFractionDigits: 1,
});

function fillRow(template: HTMLTemplateElement, item: HotItem, rank: number) {
  const fragment = template.content.cloneNode(true);
  if (!(fragment instanceof DocumentFragment)) return null;
  const li = fragment.querySelector("li");
  const row = fragment.querySelector<HTMLAnchorElement>("a[data-entry-row]");
  if (!li || !row) return null;
  row.href = `${detailPrefix}/detail/${item.u}/`;
  row.dataset.entryRow = item.u;

  const rankLabel = li.querySelector("[data-hot-rank]");
  if (rankLabel) {
    rankLabel.textContent = String(rank);
    rankLabel.toggleAttribute("data-top", rank <= 3);
  }

  const avatar = row.firstElementChild;
  if (avatar) {
    avatar.classList.remove(...[...avatar.classList].filter((name) => /^(from|to)-\[/.test(name)));
    avatar.classList.add(...avatarTint(item.t));
    const initial = avatar.querySelector("span");
    if (initial) initial.textContent = Array.from(item.t.trim())[0]?.toUpperCase() ?? "@";
    const image = avatar.querySelector("img");
    if (image && item.a) image.src = item.a;
    else image?.remove();
  }

  const title = row.querySelector(".truncate");
  if (title) title.textContent = item.t;
  if (!item.v) row.querySelector("svg[role='img']")?.remove();
  if (!item.p) {
    row.removeAttribute("data-promoted");
    row.querySelector("[data-promoted-badge]")?.remove();
  }
  const members = row.querySelector("span[title]");
  if (item.m === null) members?.remove();
  else if (members) members.textContent = compact.format(item.m);
  return li;
}

function setup(column: HTMLElement) {
  const button = column.querySelector<HTMLButtonElement>("[data-hot-shuffle]");
  const list = column.querySelector<HTMLOListElement>("[data-hot-list]");
  const template = column.querySelector<HTMLTemplateElement>("template[data-hot-template]");
  if (!button || !list || !template) return;
  let pool: Promise<HotItem[]> | undefined;
  let page = 0;

  button.addEventListener("click", async () => {
    button.setAttribute("aria-busy", "true");
    const icon = button.querySelector("[data-hot-shuffle-icon]");
    if (icon && !reduced) animate(icon, { rotate: [0, 360] }, { duration: 0.6, ease: easeOut });
    try {
      pool ??= fetch(`${dataPrefix}/data/hot-${column.dataset.homeHot}.json`)
        .then((response) => (response.ok ? response.json() : []))
        .then(parseHotPool);
      const items = await pool;
      if (items.length <= HOT_PAGE_SIZE) return;
      page += 1;
      const start = (page % Math.ceil(items.length / HOT_PAGE_SIZE)) * HOT_PAGE_SIZE;
      const rows = hotPage(items, page).flatMap(
        (item, index) => fillRow(template, item, start + index + 1) ?? [],
      );
      if (rows.length === 0) return;

      const old = [...list.children];
      if (!reduced) {
        await Promise.all(
          old.map((child, index) =>
            animate(
              child,
              { opacity: 0, translate: "-10px 0" },
              { duration: durations.fast, ease: easeOut, delay: index * STAGGER * 0.6 },
            ),
          ),
        );
      }
      list.replaceChildren(...rows);
      if (!reduced) {
        rows.forEach((row, index) => {
          animate(
            row,
            { opacity: [0, 1], translate: ["12px 0", "0 0"] },
            { ...gentle, delay: index * STAGGER },
          );
        });
      }
    } finally {
      button.removeAttribute("aria-busy");
    }
  });
}

for (const column of document.querySelectorAll<HTMLElement>("[data-home-hot]")) setup(column);
