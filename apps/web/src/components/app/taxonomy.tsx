import { type EntryKind, type Locale, MAX_TAGS, tagFacet, tagsForCategory } from "@tgbox/shared";
import { CheckIcon } from "lucide-react";
import { useState } from "react";
import { appUi } from "@/i18n/ui-app.ts";
import type { AppCategory, AppTag } from "@/lib/app-data.ts";
import { cn } from "@/lib/cn.ts";
import { fill } from "@/lib/format.ts";

/**
 * Bilingual versions of the admin's pickers (`features/entries/tag-picker.tsx`,
 * `option-select.tsx`): tap targets only, no hover-only affordances, and no Chinese baked in.
 */

const name = (item: { nameZh: string; nameEn: string }, locale: Locale) =>
  locale === "zh" ? item.nameZh : item.nameEn;

export function CategoryGrid({
  categories,
  kind,
  locale,
  value,
  onChange,
}: {
  categories: AppCategory[];
  kind: EntryKind;
  locale: Locale;
  value: number | null;
  onChange: (id: number) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {categories
        .filter((category) => category.kind === kind)
        .map((category) => (
          <button
            key={category.id}
            type="button"
            aria-pressed={category.id === value}
            onClick={() => onChange(category.id)}
            className={cn(
              "flex min-h-11 items-center justify-center rounded-xl border px-2 py-2 text-center text-xs transition-colors",
              category.id === value
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-foreground",
            )}
          >
            {name(category, locale)}
          </button>
        ))}
    </div>
  );
}

const facets = ["topic", "attribute"] as const;

/** Keeps the incoming order inside each facet, so a category's hinted tags stay in front. */
function byFacet(tags: AppTag[]) {
  return facets
    .map((facet) => ({ facet, tags: tags.filter((tag) => tagFacet(tag.slug) === facet) }))
    .filter((group) => group.tags.length > 0);
}

/**
 * The tag vocabulary is global, but only the tags that fit the chosen category are offered; the
 * rest are one tap away behind "show all". Nothing is shown before a category is picked, because
 * there is nothing to scope the offer to yet (see `.scratch/taxonomy-v2.md`).
 */
export function TagPicker({
  tags,
  kind,
  category,
  locale,
  selected,
  onChange,
}: {
  tags: AppTag[];
  kind: EntryKind;
  category: AppCategory | null;
  locale: Locale;
  selected: number[];
  onChange: (ids: number[]) => void;
}) {
  const strings = appUi(locale).submit;
  const [showAll, setShowAll] = useState(false);

  if (category === null) {
    return <p className="text-muted-foreground text-xs">{strings.tagsAfterCategory}</p>;
  }

  const { hinted, rest } = tagsForCategory(kind, category.slug, tags);
  const chosen = new Set(selected);
  // A category with no hints of its own (group "other") has nothing to narrow down to.
  // Otherwise: the hints, plus any tag the suggester picked that this category doesn't hint at —
  // hiding an already-selected chip behind "show all" would look like the selection was lost.
  const offered =
    hinted.length === 0 ? rest : [...hinted, ...rest.filter((tag) => chosen.has(tag.id))];
  const others = hinted.length === 0 ? [] : rest.filter((tag) => !chosen.has(tag.id));
  const full = selected.length >= MAX_TAGS;

  const toggle = (tag: AppTag) =>
    onChange(chosen.has(tag.id) ? selected.filter((id) => id !== tag.id) : [...selected, tag.id]);

  return (
    <div className="flex flex-col gap-3">
      {byFacet(showAll ? [...offered, ...others] : offered).map((group) => (
        <div key={group.facet} className="flex flex-col gap-1.5">
          <p className="text-muted-foreground text-xs">{strings.facets[group.facet]}</p>
          <div className="flex flex-wrap gap-1.5">
            {group.tags.map((tag) => {
              const on = chosen.has(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  aria-pressed={on}
                  disabled={!on && full}
                  onClick={() => toggle(tag)}
                  className={cn(
                    "inline-flex h-9 items-center gap-1 rounded-full border px-3 text-sm transition-colors disabled:opacity-40",
                    on
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-foreground",
                  )}
                >
                  {on && <CheckIcon className="size-3.5" aria-hidden />}
                  {name(tag, locale)}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {others.length > 0 && (
        <button
          type="button"
          aria-expanded={showAll}
          onClick={() => setShowAll(!showAll)}
          className="self-start text-primary text-xs underline underline-offset-2"
        >
          {showAll ? strings.showFewerTags : strings.showAllTags}
        </button>
      )}
      <p className="text-muted-foreground text-xs">
        {fill(strings.tagCount, { n: selected.length, max: MAX_TAGS })}
      </p>
    </div>
  );
}
