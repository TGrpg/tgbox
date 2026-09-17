import type { Locale } from "@tgbox/shared";
import { CornerDownLeftIcon, SearchXIcon, TriangleAlertIcon } from "lucide-react";
import { AnimatePresence, MotionConfig, motion, type Transition } from "motion/react";
import { useEffect, useState } from "react";
import {
  Command,
  CommandDialog,
  CommandDialogPortal,
  CommandDialogPrimitive,
  CommandEmpty,
  CommandFooter,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
} from "@/components/coss/ui/command";
import { Spinner } from "@/components/coss/ui/spinner";
import { localizePath } from "@/i18n/locale.ts";
import { springs } from "@/lib/motion-presets.ts";
import { externalSearchUrls, safeExcerpt } from "@/lib/search.ts";

interface Props {
  locale: Locale;
  /** Directory that holds `pagefind.js` (R2 public URL in production, `/pagefind` locally). */
  pagefindUrl: string;
  siteUrl: string;
  hotKeywords: string[];
  kindLabels: Record<string, string>;
  strings: {
    placeholder: string;
    dialogLabel: string;
    hot: string;
    loading: string;
    empty: string;
    error: string;
    fallback: string;
    google: string;
    bing: string;
  };
}

/** The subset of the Pagefind browser API used here. */
interface Pagefind {
  search(term: string): Promise<{ results: { data(): Promise<PagefindData> }[] }>;
}

interface PagefindData {
  url: string;
  excerpt: string;
  meta: Partial<Record<string, string>>;
  filters: Partial<Record<string, string[]>>;
}

interface Result {
  url: string;
  title: string;
  excerpt: string;
  kind: string | undefined;
  image: string | undefined;
}

const MAX_RESULTS = 10;

// Same stiffness/damping vocabulary as the vanilla layer (src/lib/motion-presets.ts).
const popupSpring: Transition = { type: "spring", ...springs.lift };
const highlightSpring: Transition = { type: "spring", ...springs.snappy };
const listSpring: Transition = { type: "spring", ...springs.gentle };
const DEBOUNCE_MS = 200;

let pagefindModule: Promise<Pagefind> | undefined;

function loadPagefind(baseUrl: string): Promise<Pagefind> {
  pagefindModule ??= import(/* @vite-ignore */ `${baseUrl}/pagefind.js`);
  return pagefindModule;
}

/** Base UI types list items as `unknown`; the input shows the title of a chosen result. */
function resultTitle(item: unknown) {
  return typeof item === "object" &&
    item !== null &&
    "title" in item &&
    typeof item.title === "string"
    ? item.title
    : "";
}

function resultUrl(item: unknown) {
  return typeof item === "object" && item !== null && "url" in item && typeof item.url === "string"
    ? item.url
    : undefined;
}

interface SearchState {
  status: "idle" | "loading" | "done" | "error";
  results: Result[];
}

export default function SearchDialog({
  locale,
  pagefindUrl,
  siteUrl,
  hotKeywords,
  kindLabels,
  strings,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SearchState>({ status: "idle", results: [] });
  const [highlighted, setHighlighted] = useState<string | undefined>();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    const onClick = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest("[data-search-trigger]")) {
        setOpen(true);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("click", onClick);
    };
  }, []);

  useEffect(() => {
    const term = query.trim();
    if (!open) return;
    if (!term) {
      // Warm the index while the visitor is still typing.
      loadPagefind(pagefindUrl).catch(() => {});
      setState({ status: "idle", results: [] });
      return;
    }
    let cancelled = false;
    setState((current) => ({ status: "loading", results: current.results }));
    const timer = setTimeout(async () => {
      try {
        const pagefind = await loadPagefind(pagefindUrl);
        const search = await pagefind.search(term);
        const data = await Promise.all(
          search.results.slice(0, MAX_RESULTS).map((result) => result.data()),
        );
        if (cancelled) return;
        setState({
          status: "done",
          results: data.map((item) => ({
            // The index is built from zh pages; `meta.url` is the language-neutral detail path.
            url: localizePath(item.meta.url ?? item.url, locale),
            title: item.meta.title ?? item.url,
            excerpt: safeExcerpt(item.excerpt),
            kind: item.filters.kind?.[0],
            image: item.meta.image,
          })),
        });
      } catch {
        pagefindModule = undefined;
        if (!cancelled) setState({ status: "error", results: [] });
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, open, pagefindUrl, locale]);

  const external = externalSearchUrls(query, siteUrl);
  const showHot = !query.trim() && hotKeywords.length > 0;
  const firstLoad = state.status === "loading" && state.results.length === 0;

  return (
    <MotionConfig reducedMotion="user">
      <CommandDialog open={open} onOpenChange={setOpen}>
        <AnimatePresence>
          {open && (
            // keepMounted hands unmounting to AnimatePresence so the exit animation can play.
            <CommandDialogPortal keepMounted>
              <CommandDialogPrimitive.Backdrop
                className="fixed inset-0 z-50 bg-[#0b1520]/40 backdrop-blur-[6px]"
                render={
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, transition: { duration: 0.15 } }}
                    transition={{ duration: 0.2 }}
                  />
                }
              />
              <CommandDialogPrimitive.Viewport className="fixed inset-0 z-50 flex flex-col items-center px-3 py-[max(--spacing(3),3vh)] sm:px-4 sm:py-[12vh]">
                <CommandDialogPrimitive.Popup
                  aria-label={strings.dialogLabel}
                  data-search-dialog
                  className="relative flex max-h-[min(34rem,100%)] min-h-0 w-full max-w-xl origin-top flex-col overflow-hidden rounded-3xl border border-border bg-popover text-popover-foreground shadow-float outline-none"
                  render={
                    <motion.div
                      initial={{ opacity: 0, scale: 0.94, y: -12 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{
                        opacity: 0,
                        scale: 0.96,
                        y: -8,
                        transition: { duration: 0.14, ease: [0.4, 0, 1, 1] },
                      }}
                      transition={popupSpring}
                    />
                  }
                >
                  <Command
                    items={state.results}
                    filter={null}
                    value={query}
                    onValueChange={setQuery}
                    onItemHighlighted={(item) => setHighlighted(resultUrl(item))}
                    itemToStringValue={resultTitle}
                  >
                    <div className="relative border-b border-border/70">
                      <CommandInput
                        placeholder={strings.placeholder}
                        aria-label={strings.dialogLabel}
                        className="text-base [&_input]:h-12 [&_input]:border-0! [&_input]:bg-transparent! [&_input]:shadow-none! [&_input]:ring-0! [&_input]:outline-none!"
                      />
                      <AnimatePresence>
                        {state.status === "loading" && (
                          <motion.span
                            aria-hidden="true"
                            className="search-progress absolute inset-x-0 bottom-0 h-0.5 overflow-hidden"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                          />
                        )}
                      </AnimatePresence>
                    </div>
                    <CommandPanel className="mx-0 rounded-none border-0 bg-transparent shadow-none [clip-path:none]!">
                      {showHot && (
                        <div className="px-4 pt-4 pb-5">
                          <p className="text-xs font-medium tracking-wide text-muted-foreground">
                            {strings.hot}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {hotKeywords.map((keyword, index) => (
                              <motion.button
                                key={keyword}
                                type="button"
                                className="rounded-full bg-muted px-3 py-1 text-sm text-foreground/80 transition-colors hover:bg-primary-soft hover:text-primary-soft-foreground"
                                initial={{ opacity: 0, y: 6 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ ...listSpring, delay: 0.06 + index * 0.03 }}
                                whileTap={{ scale: 0.94 }}
                                onClick={() => setQuery(keyword)}
                              >
                                {keyword}
                              </motion.button>
                            ))}
                          </div>
                        </div>
                      )}
                      {firstLoad && (
                        <div aria-live="polite" className="space-y-1 p-2">
                          <span className="sr-only">{strings.loading}</span>
                          {[0, 1, 2].map((row) => (
                            <div
                              key={row}
                              className="flex items-center gap-3 rounded-2xl px-2 py-2.5"
                            >
                              <span className="size-10 shrink-0 animate-pulse rounded-full bg-muted" />
                              <span className="flex-1 space-y-2">
                                <span
                                  className="block h-3 animate-pulse rounded-full bg-muted"
                                  style={{ width: `${56 - row * 12}%` }}
                                />
                                <span className="block h-2.5 w-4/5 animate-pulse rounded-full bg-muted/70" />
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      <CommandEmpty className="not-empty:py-0">
                        {state.status === "done" || state.status === "error" ? (
                          <motion.div
                            className="flex flex-col items-center gap-2 px-6 py-10"
                            initial={{ opacity: 0, scale: 0.96 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={listSpring}
                          >
                            <span className="grid size-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
                              {state.status === "error" ? (
                                <TriangleAlertIcon className="size-5" />
                              ) : (
                                <SearchXIcon className="size-5" />
                              )}
                            </span>
                            <span className="text-sm text-muted-foreground">
                              {state.status === "error" ? strings.error : strings.empty}
                            </span>
                          </motion.div>
                        ) : null}
                      </CommandEmpty>
                      <CommandList className="not-empty:p-2">
                        {(item: Result, index: number) => (
                          <CommandItem
                            key={item.url}
                            value={item}
                            render={
                              <motion.a
                                href={item.url}
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ ...listSpring, delay: Math.min(index, 8) * 0.035 }}
                              />
                            }
                            className="relative isolate items-center gap-3 rounded-2xl px-2 py-2 text-foreground data-highlighted:bg-transparent data-highlighted:text-foreground"
                            data-search-result
                          >
                            {highlighted === item.url && (
                              <motion.span
                                layoutId="search-highlight"
                                aria-hidden="true"
                                className="absolute inset-0 -z-10 rounded-2xl bg-primary-soft"
                                transition={highlightSpring}
                              />
                            )}
                            <img
                              src={item.image || "/images/default-avatar.svg"}
                              alt=""
                              width="40"
                              height="40"
                              loading="lazy"
                              className="size-10 shrink-0 rounded-full bg-muted object-cover ring-1 ring-border"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-2">
                                <span className="truncate font-semibold">{item.title}</span>
                                {item.kind && kindLabels[item.kind] && (
                                  <span className="shrink-0 rounded-full bg-muted px-2 py-px text-[0.68rem] font-medium text-muted-foreground">
                                    {kindLabels[item.kind]}
                                  </span>
                                )}
                              </span>
                              <span
                                className="mt-0.5 line-clamp-1 text-xs text-muted-foreground [&_mark]:bg-transparent [&_mark]:font-semibold [&_mark]:text-primary-accent"
                                dangerouslySetInnerHTML={{ __html: item.excerpt }}
                              />
                            </span>
                            {highlighted === item.url && (
                              <CornerDownLeftIcon
                                aria-hidden="true"
                                className="size-4 shrink-0 text-primary-soft-foreground max-sm:hidden"
                              />
                            )}
                          </CommandItem>
                        )}
                      </CommandList>
                      {state.status === "loading" && state.results.length > 0 && (
                        <Spinner className="absolute top-3 right-3 size-4 text-muted-foreground" />
                      )}
                    </CommandPanel>
                    <CommandFooter className="rounded-none bg-muted/50 px-4 py-2.5">
                      <span className="truncate">{strings.fallback}</span>
                      <span className="flex shrink-0 gap-1">
                        {[
                          { href: external.google, label: strings.google },
                          { href: external.bing, label: strings.bing },
                        ].map((link) => (
                          <a
                            key={link.label}
                            href={link.href}
                            target="_blank"
                            rel="noopener nofollow"
                            className="rounded-full px-2.5 py-1 font-medium text-foreground transition-colors hover:bg-card"
                          >
                            {link.label}
                          </a>
                        ))}
                      </span>
                    </CommandFooter>
                  </Command>
                </CommandDialogPrimitive.Popup>
              </CommandDialogPrimitive.Viewport>
            </CommandDialogPortal>
          )}
        </AnimatePresence>
      </CommandDialog>
    </MotionConfig>
  );
}
