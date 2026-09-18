import { type EntryKind, entryKinds, type Locale, promoClickUrl } from "@tgbox/shared";
import { SearchIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Spinner } from "@/components/coss/ui/spinner";
import { appUi } from "@/i18n/ui-app.ts";
import { APP_BROWSE_LIMIT, type AppBrowse } from "@/lib/app-data.ts";
import { cn } from "@/lib/cn.ts";
import { loadPagefind, resetPagefind } from "@/lib/pagefind.ts";
import { BannerCard } from "./banner-card.tsx";
import { type BrowseItem, EntryCard } from "./entry-card.tsx";
import { useWebApp } from "./shell.tsx";
import { useStaticJson } from "./use-static.ts";

const DEBOUNCE_MS = 200;
const MAX_RESULTS = 20;

type Tab = "all" | EntryKind;

type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; results: BrowseItem[] }
  | { status: "error" };

function isKind(value: string | undefined): value is EntryKind {
  return entryKinds.some((kind) => kind === value);
}

/** Pagefind's own result shape, narrowed to what a card needs. */
function toItem(data: {
  url: string;
  meta: Partial<Record<string, string>>;
  filters: Partial<Record<string, string[]>>;
}): BrowseItem[] {
  const path = data.meta.url ?? data.url;
  const username = path.split("/").filter(Boolean).at(-1);
  const kind = data.filters.kind?.[0];
  if (!username || !isKind(kind)) return [];
  return [
    {
      username,
      kind,
      title: data.meta.title ?? username,
      members: null,
      avatarUrl: data.meta.image ?? null,
    },
  ];
}

/**
 * Browse: the static entry list plus Pagefind, both served as files. This screen costs no Worker
 * request at all — see `.scratch/miniapp-contract.md`.
 */
export function BrowseScreen({
  locale,
  pagefindUrl,
  siteUrl,
}: {
  locale: Locale;
  pagefindUrl: string;
  siteUrl: string;
}) {
  const strings = appUi(locale);
  const webApp = useWebApp();
  const browse = useStaticJson<AppBrowse>("/data/app-browse.json");
  const entries =
    browse.status === "ready" ? { status: "ready" as const, data: browse.data.entries } : browse;
  // Paid ads open through the site's click counter, as they do on the site.
  const openAd = (id: string) => {
    const url = `${siteUrl}${promoClickUrl(id)}`;
    if (webApp) webApp.openLink(url);
    else window.open(url, "_blank", "noopener");
  };
  const [tab, setTab] = useState<Tab>("all");
  const tabs: Tab[] = ["all", ...entryKinds];
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchState>({ status: "idle" });

  useEffect(() => {
    const term = query.trim();
    if (term === "") {
      setSearch({ status: "idle" });
      return;
    }
    let cancelled = false;
    setSearch({ status: "loading" });
    const timer = setTimeout(async () => {
      try {
        const pagefind = await loadPagefind(pagefindUrl);
        const found = await pagefind.search(term);
        const data = await Promise.all(
          found.results.slice(0, MAX_RESULTS).map((result) => result.data()),
        );
        if (!cancelled) setSearch({ status: "done", results: data.flatMap(toItem) });
      } catch {
        resetPagefind();
        if (!cancelled) setSearch({ status: "error" });
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, pagefindUrl]);

  const searching = query.trim() !== "";
  const listed = entries.status === "ready" ? entries.data : [];
  const results = search.status === "done" ? search.results : [];
  const items = (searching ? results : listed).filter((item) => tab === "all" || item.kind === tab);
  const capped =
    !searching &&
    tab !== "all" &&
    listed.filter((entry) => entry.kind === tab).length >= APP_BROWSE_LIMIT;

  return (
    <div className="flex flex-col gap-3 px-4 pt-4">
      <h1 className="sr-only">{strings.browse.title}</h1>
      <div className="relative">
        <SearchIcon
          className="-translate-y-1/2 absolute top-1/2 left-3 size-4 text-muted-foreground"
          aria-hidden
        />
        <input
          type="search"
          id="app-browse-search"
          name="q"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={strings.browse.search}
          aria-label={strings.browse.search}
          className="h-11 w-full rounded-full border border-input bg-card pr-10 pl-9 text-base outline-none focus-visible:border-primary"
        />
        {searching && (
          <button
            type="button"
            aria-label={strings.browse.clear}
            onClick={() => setQuery("")}
            className="-translate-y-1/2 absolute top-1/2 right-3 text-muted-foreground"
          >
            <XIcon className="size-4" aria-hidden />
          </button>
        )}
      </div>

      <div role="tablist" aria-label={strings.browse.title} className="flex gap-1.5">
        {tabs.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={key === tab}
            onClick={() => setTab(key)}
            className={cn(
              "h-8 flex-1 rounded-full border border-border text-sm transition-colors",
              key === tab
                ? "border-primary/40 bg-primary-soft font-semibold text-primary-soft-foreground"
                : "text-muted-foreground",
            )}
          >
            {key === "all" ? strings.browse.all : strings.kind[key]}
          </button>
        ))}
      </div>

      {search.status === "error" && (
        <p className="rounded-xl bg-muted p-3 text-muted-foreground text-xs">
          {strings.browse.searchError}
        </p>
      )}

      {(entries.status === "loading" || (searching && search.status === "loading")) && (
        <p
          className="flex items-center gap-2 py-6 text-muted-foreground text-sm"
          aria-live="polite"
        >
          <Spinner className="size-4" />
          {searching ? strings.browse.searching : strings.common.loading}
        </p>
      )}

      {entries.status === "error" && !searching && (
        <p className="py-6 text-center text-muted-foreground text-sm">{strings.common.error}</p>
      )}

      {!searching && browse.status === "ready" && (
        <SponsoredStrip ads={browse.data} locale={locale} onOpen={openAd} />
      )}

      <ul className="flex flex-col gap-2">
        {items.map((entry) => (
          <EntryCard
            key={entry.username}
            entry={entry}
            locale={locale}
            webApp={webApp}
            siteUrl={siteUrl}
          />
        ))}
      </ul>

      {items.length === 0 && (entries.status === "ready" || search.status === "done") && (
        <p className="py-10 text-center text-muted-foreground text-sm">
          {searching ? strings.browse.noResults : strings.browse.empty}
        </p>
      )}

      {capped && (
        <p className="pb-2 text-center text-muted-foreground text-xs">{strings.browse.capped}</p>
      )}
    </div>
  );
}

/** The paid announcement bar and banners, above the list; tapping counts a click like on the site. */
function SponsoredStrip({
  ads,
  locale,
  onOpen,
}: {
  ads: AppBrowse;
  locale: Locale;
  onOpen: (id: string) => void;
}) {
  const strings = appUi(locale).browse;
  // Picked once per mount, so the bar doesn't change under the user's finger on re-render.
  const [announcement] = useState(
    () => ads.announcements[Math.floor(Math.random() * ads.announcements.length)] ?? null,
  );
  if (!announcement && ads.banners.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {announcement && (
        <button
          type="button"
          onClick={() => onOpen(announcement.id)}
          className="flex items-center gap-2 rounded-2xl border border-border bg-card px-3 py-2.5 text-left text-sm"
        >
          <span className="shrink-0 rounded-full bg-primary-soft px-2 py-0.5 font-semibold text-primary-soft-foreground text-xs">
            {strings.promoted}
          </span>
          <span className="min-w-0 flex-1 truncate" dir="auto">
            {announcement.title} · {announcement.subtitle}
          </span>
        </button>
      )}
      {ads.banners.length > 0 && (
        <div className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1">
          {ads.banners.map((banner) => (
            <button
              key={banner.id}
              type="button"
              onClick={() => onOpen(banner.id)}
              className="w-64 shrink-0 snap-start text-left"
            >
              <BannerCard
                title={banner.title}
                subtitle={banner.subtitle}
                imageUrl={banner.imageUrl}
                seed={banner.id}
                adLabel={strings.ad}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
