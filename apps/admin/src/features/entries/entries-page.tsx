import { useQuery } from "@tanstack/react-query";
import {
  createColumnHelper,
  type RowSelectionState,
  rowSelectionFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { BadgeCheckIcon, ChevronLeftIcon, ChevronRightIcon, StarIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/coss/ui/avatar.tsx";
import { Badge } from "@/components/coss/ui/badge.tsx";
import { Button } from "@/components/coss/ui/button.tsx";
import { Card } from "@/components/coss/ui/card.tsx";
import { Checkbox } from "@/components/coss/ui/checkbox.tsx";
import { Skeleton } from "@/components/coss/ui/skeleton.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/coss/ui/table.tsx";
import { PageHeader } from "@/components/shell/page-header.tsx";
import { type EntryRow, entriesQueryOptions } from "@/functions/entries.ts";
import { taxonomyQueryOptions } from "@/functions/taxonomy.ts";
import { BulkBar } from "./bulk-bar.tsx";
import { EditEntrySheet } from "./edit-sheet.tsx";
import { EntryFilters } from "./filters.tsx";
import {
  activityLabel,
  formatCount,
  formatDate,
  kindLabel,
  livenessLabel,
  livenessVariant,
  statusLabel,
  statusVariant,
} from "./labels.ts";
import { RowActions } from "./row-actions.tsx";
import { ENTRIES_PAGE_SIZE, type EntriesSearch } from "./search.ts";

const features = tableFeatures({ rowSelectionFeature });
const helper = createColumnHelper<typeof features, EntryRow>();
const EMPTY: EntryRow[] = [];
const ease = [0.16, 1, 0.3, 1] as const;

type Names = { categories: Map<number, string>; tags: Map<number, string> };

export function EntriesPage({
  search,
  setSearch,
}: {
  search: EntriesSearch;
  setSearch: (patch: Partial<EntriesSearch>) => void;
}) {
  const list = useQuery(entriesQueryOptions(search));
  const taxonomy = useQuery(taxonomyQueryOptions());
  const [editing, setEditing] = useState<EntryRow | null>(null);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const siteUrl = list.data?.siteUrl ?? "";

  // Selection belongs to one result page.
  const searchKey = JSON.stringify(search);
  useEffect(() => {
    void searchKey;
    setRowSelection({});
  }, [searchKey]);

  const names: Names = useMemo(
    () => ({
      categories: new Map((taxonomy.data?.categories ?? []).map((row) => [row.id, row.nameZh])),
      tags: new Map((taxonomy.data?.tags ?? []).map((row) => [row.id, row.nameZh])),
    }),
    [taxonomy.data],
  );

  const columns = useMemo(
    () =>
      helper.columns([
        helper.display({
          id: "select",
          header: ({ table }) => (
            <Checkbox
              aria-label="选择本页全部"
              checked={table.getIsAllPageRowsSelected()}
              indeterminate={table.getIsSomePageRowsSelected() && !table.getIsAllPageRowsSelected()}
              onCheckedChange={(checked) => table.toggleAllPageRowsSelected(checked)}
            />
          ),
          cell: ({ row }) => (
            <Checkbox
              aria-label={`选择 ${row.original.title}`}
              checked={row.getIsSelected()}
              onCheckedChange={(checked) => row.toggleSelected(checked)}
            />
          ),
        }),
        helper.display({
          id: "entry",
          header: "条目",
          cell: ({ row }) => <EntryIdentity entry={row.original} />,
        }),
        helper.accessor("kind", { header: "类型", cell: ({ getValue }) => kindLabel[getValue()] }),
        helper.accessor("categoryId", {
          header: "分类",
          cell: ({ getValue }) => names.categories.get(getValue()) ?? "—",
        }),
        helper.accessor("tagIds", {
          header: "标签",
          cell: ({ getValue }) => <TagList ids={getValue()} names={names} />,
        }),
        helper.accessor("members", {
          header: "成员",
          cell: ({ getValue }) => <span className="tabular-nums">{formatCount(getValue())}</span>,
        }),
        helper.accessor("activityTier", {
          header: "活跃",
          cell: ({ getValue }) => activityLabel(getValue()),
        }),
        helper.accessor("liveness", {
          header: "存活",
          cell: ({ getValue }) => (
            <Badge variant={livenessVariant[getValue()]}>{livenessLabel[getValue()]}</Badge>
          ),
        }),
        helper.accessor("status", {
          header: "状态",
          cell: ({ getValue }) => (
            <Badge variant={statusVariant[getValue()]}>{statusLabel[getValue()]}</Badge>
          ),
        }),
        helper.accessor("promoted", {
          header: "推广",
          cell: ({ getValue }) =>
            getValue() ? (
              <StarIcon
                className="size-4 fill-current text-warning-foreground"
                aria-label="推广中"
              />
            ) : null,
        }),
        helper.accessor("listedAt", {
          header: "收录",
          cell: ({ getValue }) => formatDate(getValue()),
        }),
        helper.accessor("updatedAt", {
          header: "更新",
          cell: ({ getValue }) => formatDate(getValue()),
        }),
        helper.display({
          id: "actions",
          header: () => <span className="sr-only">操作</span>,
          cell: ({ row }) => (
            <RowActions entry={row.original} siteUrl={siteUrl} onEdit={setEditing} />
          ),
        }),
      ]),
    [names, siteUrl],
  );

  const table = useTable({
    features,
    columns,
    data: list.data?.rows ?? EMPTY,
    getRowId: (row) => String(row.id),
    state: { rowSelection },
    onRowSelectionChange: setRowSelection,
  });

  const rows = table.getRowModel().rows;
  const selected = rows.filter((row) => row.getIsSelected()).map((row) => row.original);
  const total = list.data?.total ?? 0;
  const page = search.page ?? 1;
  const pages = Math.max(1, Math.ceil(total / ENTRIES_PAGE_SIZE));
  const clearSelection = useCallback(() => setRowSelection({}), []);

  return (
    <>
      <PageHeader
        title="条目管理"
        description={
          list.data ? `共 ${total.toLocaleString("zh-CN")} 条` : "筛选、搜索与批量操作已收录条目。"
        }
      />
      <div className="flex flex-col gap-4">
        <EntryFilters
          search={search}
          categories={taxonomy.data?.categories ?? []}
          onChange={setSearch}
        />

        {list.isError ? (
          <p className="text-destructive-foreground text-sm">加载失败：{list.error.message}</p>
        ) : list.isPending ? (
          <div className="flex flex-col gap-2">
            {["a", "b", "c", "d", "e", "f"].map((key) => (
              <Skeleton key={key} className="h-14 rounded-xl" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <Card className="items-center p-10 text-muted-foreground text-sm">
            没有符合条件的条目
          </Card>
        ) : (
          <div
            className={
              list.isPlaceholderData ? "opacity-60 transition-opacity" : "transition-opacity"
            }
          >
            {/* Desktop: table */}
            <Card className="hidden overflow-hidden p-0 md:block">
              <Table>
                <TableHeader>
                  {table.getHeaderGroups().map((group) => (
                    <TableRow key={group.id}>
                      {group.headers.map((header) => (
                        <TableHead key={header.id} className="whitespace-nowrap">
                          {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                        </TableHead>
                      ))}
                    </TableRow>
                  ))}
                </TableHeader>
                <TableBody>
                  <AnimatePresence initial={false}>
                    {rows.map((row, index) => (
                      <motion.tr
                        key={row.id}
                        layout="position"
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, x: -12 }}
                        transition={{ duration: 0.25, delay: Math.min(index, 12) * 0.015, ease }}
                        data-state={row.getIsSelected() ? "selected" : undefined}
                        className="border-b transition-colors last:border-0 hover:bg-muted/50 data-[state=selected]:bg-muted"
                      >
                        {row.getAllCells().map((cell) => (
                          <TableCell key={cell.id} className="whitespace-nowrap">
                            <table.FlexRender cell={cell} />
                          </TableCell>
                        ))}
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                </TableBody>
              </Table>
            </Card>

            {/* Mobile: cards */}
            <ul className="flex flex-col gap-2 md:hidden">
              <AnimatePresence initial={false}>
                {rows.map((row, index) => (
                  <motion.li
                    key={row.id}
                    layout="position"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -16 }}
                    transition={{ duration: 0.25, delay: Math.min(index, 10) * 0.02, ease }}
                  >
                    <Card
                      className="gap-3 p-3 data-[state=selected]:border-primary"
                      data-state={row.getIsSelected() ? "selected" : undefined}
                    >
                      <div className="flex items-start gap-3">
                        <Checkbox
                          className="mt-2.5"
                          aria-label={`选择 ${row.original.title}`}
                          checked={row.getIsSelected()}
                          onCheckedChange={(checked) => row.toggleSelected(checked)}
                        />
                        <div className="min-w-0 flex-1">
                          <EntryIdentity entry={row.original} />
                        </div>
                        <RowActions entry={row.original} siteUrl={siteUrl} onEdit={setEditing} />
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-muted-foreground text-xs">
                        <Badge variant={statusVariant[row.original.status]}>
                          {statusLabel[row.original.status]}
                        </Badge>
                        <Badge variant={livenessVariant[row.original.liveness]}>
                          {livenessLabel[row.original.liveness]}
                        </Badge>
                        {row.original.promoted && <Badge variant="warning">推广</Badge>}
                        <span>{kindLabel[row.original.kind]}</span>·
                        <span>{names.categories.get(row.original.categoryId) ?? "—"}</span>·
                        <span className="tabular-nums">
                          {formatCount(row.original.members)} 成员
                        </span>
                        ·<span>活跃度 {activityLabel(row.original.activityTier)}</span>
                      </div>
                      {row.original.tagIds.length > 0 && (
                        <TagList ids={row.original.tagIds} names={names} />
                      )}
                    </Card>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </div>
        )}

        {total > 0 && (
          <div className="flex items-center justify-between gap-3 text-muted-foreground text-sm">
            <span className="tabular-nums">
              第 {page} / {pages} 页
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setSearch({ page: page - 1 })}
              >
                <ChevronLeftIcon /> 上一页
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pages}
                onClick={() => setSearch({ page: page + 1 })}
              >
                下一页 <ChevronRightIcon />
              </Button>
            </div>
          </div>
        )}
      </div>

      <BulkBar
        selected={selected}
        categories={taxonomy.data?.categories ?? []}
        onClear={clearSelection}
      />
      <EditEntrySheet entry={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function EntryIdentity({ entry }: { entry: EntryRow }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar className="size-9 bg-muted">
        {entry.avatarUrl && <AvatarImage src={entry.avatarUrl} alt="" />}
        <AvatarFallback>{entry.title.slice(0, 1).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <div className="flex items-center gap-1 font-medium">
          <span className="max-w-56 truncate">{entry.title}</span>
          {entry.verified && (
            <BadgeCheckIcon
              className="size-3.5 shrink-0 text-info-foreground"
              aria-label="已认证"
            />
          )}
        </div>
        <div className="truncate text-muted-foreground text-xs">@{entry.username}</div>
      </div>
    </div>
  );
}

function TagList({ ids, names }: { ids: number[]; names: Names }) {
  if (ids.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {ids.map((id) => (
        <Badge key={id} variant="outline">
          {names.tags.get(id) ?? id}
        </Badge>
      ))}
    </div>
  );
}
