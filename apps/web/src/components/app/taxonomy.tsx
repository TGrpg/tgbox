import { type EntryKind, type Locale, MAX_TAGS } from "@tgbox/shared";
import { CheckIcon } from "lucide-react";
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

export function TagPicker({
  tags,
  locale,
  selected,
  onChange,
}: {
  tags: AppTag[];
  locale: Locale;
  selected: number[];
  onChange: (ids: number[]) => void;
}) {
  const strings = appUi(locale).submit;
  const full = selected.length >= MAX_TAGS;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag) => {
          const on = selected.includes(tag.id);
          return (
            <button
              key={tag.id}
              type="button"
              aria-pressed={on}
              disabled={!on && full}
              onClick={() =>
                onChange(on ? selected.filter((id) => id !== tag.id) : [...selected, tag.id])
              }
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
      <p className="text-muted-foreground text-xs">
        {fill(strings.tagCount, { n: selected.length, max: MAX_TAGS })}
      </p>
    </div>
  );
}
