import { EntryKind, type EntrySort, EntryStatus, entrySorts, Liveness } from "@tgbox/shared";
import { SearchIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/coss/ui/button.tsx";
import { Input } from "@/components/coss/ui/input.tsx";
import { kindLabel, langLabel, livenessLabel, statusLabel } from "./labels.ts";
import { OptionSelect } from "./option-select.tsx";
import type { EntriesSearch } from "./search.ts";

type Category = { id: number; kind: EntryKind; nameZh: string };

const sortLabel: Record<EntrySort, string> = {
  id_desc: "最新收录",
  id_asc: "最早收录",
  members_desc: "成员最多",
  updated_desc: "最近更新",
};

export function EntryFilters({
  search,
  categories,
  onChange,
}: {
  search: EntriesSearch;
  categories: Category[];
  /** a partial patch; page resets to 1 */
  onChange: (patch: Partial<EntriesSearch>) => void;
}) {
  const [q, setQ] = useState(search.q ?? "");
  useEffect(() => setQ(search.q ?? ""), [search.q]);
  useEffect(() => {
    const next = q.trim() || undefined;
    if (next === search.q) return;
    const timer = setTimeout(() => onChange({ q: next }), 300);
    return () => clearTimeout(timer);
  }, [q, search.q, onChange]);

  const visibleCategories = categories.filter((row) => !search.kind || row.kind === search.kind);
  const active =
    [
      search.kind,
      search.category,
      search.status,
      search.liveness,
      search.lang,
      search.promoted,
      search.q,
    ].filter((value) => value !== undefined).length > 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <SearchIcon
            className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 z-10 size-4 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="搜索用户名或标题"
            aria-label="搜索用户名或标题"
            className="*:data-[slot=input]:ps-9"
          />
        </div>
        <OptionSelect
          label="排序"
          value={search.sort ?? "id_desc"}
          options={entrySorts.map((value) => ({ value, label: sortLabel[value] }))}
          onChange={(value) => onChange({ sort: entrySorts.find((sort) => sort === value) })}
          className="w-32 shrink-0"
        />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:flex lg:flex-wrap [&>*]:lg:w-36">
        <OptionSelect
          label="类型"
          allLabel="全部类型"
          value={search.kind}
          options={EntryKind.options.map((value) => ({ value, label: kindLabel[value] }))}
          onChange={(value) => {
            const kind = EntryKind.safeParse(value);
            onChange({ kind: kind.success ? kind.data : undefined, category: undefined });
          }}
        />
        <OptionSelect
          label="分类"
          allLabel="全部分类"
          value={search.category === undefined ? undefined : String(search.category)}
          options={visibleCategories.map((row) => ({
            value: String(row.id),
            label: search.kind ? row.nameZh : `${row.nameZh} · ${kindLabel[row.kind]}`,
          }))}
          onChange={(value) =>
            onChange({ category: value === undefined ? undefined : Number(value) })
          }
        />
        <OptionSelect
          label="状态"
          allLabel="全部状态"
          value={search.status}
          options={EntryStatus.options.map((value) => ({ value, label: statusLabel[value] }))}
          onChange={(value) => {
            const status = EntryStatus.safeParse(value);
            onChange({ status: status.success ? status.data : undefined });
          }}
        />
        <OptionSelect
          label="存活"
          allLabel="全部存活状态"
          value={search.liveness}
          options={Liveness.options.map((value) => ({ value, label: livenessLabel[value] }))}
          onChange={(value) => {
            const liveness = Liveness.safeParse(value);
            onChange({ liveness: liveness.success ? liveness.data : undefined });
          }}
        />
        <OptionSelect
          label="语言"
          allLabel="全部语言"
          value={search.lang}
          options={Object.entries(langLabel).map(([value, label]) => ({ value, label }))}
          onChange={(value) => onChange({ lang: value })}
        />
        <OptionSelect
          label="推广"
          allLabel="推广不限"
          value={search.promoted === undefined ? undefined : search.promoted ? "yes" : "no"}
          options={[
            { value: "yes", label: "推广中" },
            { value: "no", label: "未推广" },
          ]}
          onChange={(value) =>
            onChange({ promoted: value === undefined ? undefined : value === "yes" })
          }
        />
        {active && (
          <Button
            variant="ghost"
            onClick={() =>
              onChange({
                kind: undefined,
                category: undefined,
                status: undefined,
                liveness: undefined,
                lang: undefined,
                promoted: undefined,
                q: undefined,
              })
            }
          >
            <XIcon /> 清除筛选
          </Button>
        )}
      </div>
    </div>
  );
}
