import { MAX_TAGS } from "@tgbox/shared";
import { CheckIcon } from "lucide-react";
import { cn } from "@/lib/cn.ts";

type Tag = { id: number; nameZh: string };

/** Tap-to-toggle tag chips (works with touch; no hover-only affordances). */
export function TagPicker({
  tags,
  selected,
  onChange,
}: {
  tags: Tag[];
  selected: number[];
  onChange: (ids: number[]) => void;
}) {
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
                "inline-flex h-8 items-center gap-1 rounded-full border px-3 text-sm transition-colors disabled:opacity-40",
                on
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input bg-background text-foreground hover:bg-accent",
              )}
            >
              {on && <CheckIcon className="size-3.5" aria-hidden />}
              {tag.nameZh}
            </button>
          );
        })}
      </div>
      <p className="text-muted-foreground text-xs">
        已选 {selected.length} / {MAX_TAGS}
      </p>
    </div>
  );
}
