import { useQuery } from "@tanstack/react-query";
import {
  type ColumnDef,
  flexRender,
  type RowSelectionState,
  rowSelectionFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import type { RejectReason } from "@tgbox/core";
import type { Submission } from "@tgbox/db";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, InboxIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Avatar, AvatarFallback } from "@/components/coss/ui/avatar.tsx";
import { Badge } from "@/components/coss/ui/badge.tsx";
import { Button } from "@/components/coss/ui/button.tsx";
import { Card } from "@/components/coss/ui/card.tsx";
import { Checkbox } from "@/components/coss/ui/checkbox.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/coss/ui/empty.tsx";
import { Skeleton } from "@/components/coss/ui/skeleton.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/coss/ui/table.tsx";
import { Tabs, TabsList, TabsTab } from "@/components/coss/ui/tabs.tsx";
import { PageHeader } from "@/components/shell/page-header.tsx";
import { UserChip } from "@/components/user-chip.tsx";
import {
  MAX_BULK,
  type ReviewTab,
  reviewQueueQueryOptions,
  reviewTabs,
} from "@/functions/review.ts";
import { taxonomyQueryOptions } from "@/functions/taxonomy.ts";
import { cn } from "@/lib/cn.ts";
import { compactNumber, dateTime, kindLabels, rejectReasonLabel } from "./labels.ts";
import { activeAfterRemoval, moveActive, reviewShortcut } from "./queue-keys.ts";
import { initial, Kbd, RejectSelect, SubmissionDrawer } from "./submission-drawer.tsx";
import { useReviewActions } from "./use-review-actions.ts";

const PAGE_SIZE = 50;
const tabLabels: Record<ReviewTab, string> = {
  pending: "待审核",
  approved: "已通过",
  rejected: "已拒绝",
};
const ease = [0.16, 1, 0.3, 1] as const;
const features = tableFeatures({ rowSelectionFeature });
type Column = ColumnDef<typeof features, Submission>;

export function ReviewQueue({
  tab,
  onTabChange,
}: {
  tab: ReviewTab;
  onTabChange: (tab: ReviewTab) => void;
}) {
  return (
    <>
      <PageHeader
        title="审核队列"
        description="预览抓取资料，通过或拒绝提交（支持批量；桌面端 J/K 切换，A 通过，R 拒绝）。"
      />
      <Tabs
        value={tab}
        onValueChange={(value) => {
          const next = reviewTabs.find((item) => item === value);
          if (next) onTabChange(next);
        }}
      >
        <TabsList className="mb-4">
          {reviewTabs.map((item) => (
            <TabsTab key={item} value={item}>
              {tabLabels[item]}
            </TabsTab>
          ))}
        </TabsList>
      </Tabs>
      {/* Remount per tab: selection, paging and the active row belong to one list. */}
      <QueueList key={tab} tab={tab} />
    </>
  );
}

function QueueList({ tab }: { tab: ReviewTab }) {
  const [page, setPage] = useState(1);
  const queue = useQuery(reviewQueueQueryOptions(tab, page));
  const taxonomy = useQuery(taxonomyQueryOptions());
  const { approve, reject } = useReviewActions(page);
  const pending = tab === "pending";

  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [activeId, setActiveId] = useState<number | null>(null);
  const [drawerId, setDrawerId] = useState<number | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);

  const rows = queue.data?.rows;
  const ids = useMemo(() => rows?.map((row) => row.id) ?? [], [rows]);

  const names = useMemo(() => {
    const categories = new Map(taxonomy.data?.categories.map((c) => [c.id, c.nameZh]));
    const tags = new Map(taxonomy.data?.tags.map((t) => [t.id, t.nameZh]));
    return {
      category: (id: number) => categories.get(id) ?? `#${id}`,
      tag: (id: number) => tags.get(id) ?? `#${id}`,
    };
  }, [taxonomy.data]);

  const afterAction = useCallback(
    (removed: number[]) => {
      setRowSelection((selection) =>
        Object.fromEntries(
          Object.entries(selection).filter(([id]) => !removed.includes(Number(id))),
        ),
      );
      setActiveId((active) => activeAfterRemoval(ids, removed, active));
      setDrawerId((open) => (open !== null && removed.includes(open) ? null : open));
      setRejectOpen(false);
    },
    [ids],
  );

  const approveIds = useCallback(
    (targets: number[]) => {
      if (targets.length === 0) return;
      afterAction(targets);
      approve.mutate(targets);
    },
    [afterAction, approve],
  );
  const rejectIds = useCallback(
    (targets: number[], reason: RejectReason) => {
      if (targets.length === 0) return;
      afterAction(targets);
      reject.mutate({ ids: targets, reason });
    },
    [afterAction, reject],
  );

  const columns = useMemo<Column[]>(
    () => [
      ...(pending
        ? [
            {
              id: "select",
              header: ({ table }) => (
                <Checkbox
                  aria-label="全选"
                  checked={table.getIsAllRowsSelected()}
                  indeterminate={table.getIsSomeRowsSelected()}
                  onCheckedChange={(checked) => table.toggleAllRowsSelected(checked)}
                />
              ),
              cell: ({ row }) => (
                <Checkbox
                  aria-label={`选择 @${row.original.username}`}
                  checked={row.getIsSelected()}
                  onCheckedChange={(checked) => row.toggleSelected(checked)}
                  onClick={(event) => event.stopPropagation()}
                />
              ),
            } satisfies Column,
          ]
        : []),
      {
        id: "entity",
        header: "名称",
        cell: ({ row }) => <Identity submission={row.original} />,
      },
      {
        id: "kind",
        header: "类型",
        cell: ({ row }) => <Badge variant="outline">{kindLabels[row.original.kind]}</Badge>,
      },
      {
        id: "category",
        header: "分类 / 标签",
        cell: ({ row }) => <Taxonomy submission={row.original} names={names} />,
      },
      {
        id: "members",
        header: () => <span className="block text-right">成员</span>,
        cell: ({ row }) => (
          <span className="block text-right tabular-nums">
            {compactNumber(row.original.fetchedMembers)}
          </span>
        ),
      },
      {
        id: "submitter",
        header: "提交者",
        cell: ({ row }) => <UserChip id={row.original.tgUserId} size="sm" className="max-w-40" />,
      },
      {
        id: "time",
        header: pending ? "提交时间" : "审核时间",
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {dateTime(row.original.reviewedAt ?? row.original.createdAt)}
          </span>
        ),
      },
      ...(pending
        ? [
            {
              id: "actions",
              header: () => <span className="sr-only">操作</span>,
              cell: ({ row }) => (
                <RowActions
                  onApprove={() => approveIds([row.original.id])}
                  onReject={(reason) => rejectIds([row.original.id], reason)}
                />
              ),
            } satisfies Column,
          ]
        : [
            {
              id: "result",
              header: "结果",
              cell: ({ row }) =>
                row.original.status === "approved" ? (
                  <Badge variant="success">已通过</Badge>
                ) : (
                  <Badge variant="error">{rejectLabel(row.original.rejectReason)}</Badge>
                ),
            } satisfies Column,
          ]),
    ],
    [pending, names, approveIds, rejectIds],
  );

  const table = useTable({
    features,
    data: rows ?? [],
    columns,
    getRowId: (row) => String(row.id),
    state: { rowSelection },
    onRowSelectionChange: setRowSelection,
    enableRowSelection: pending,
  });

  const selectedIds = Object.keys(rowSelection)
    .filter((id) => rowSelection[id])
    .map(Number)
    .filter((id) => ids.includes(id));
  const drawerSubmission = rows?.find((row) => row.id === drawerId);

  // Desktop keyboard review. Skipped while typing or when a popup (select) owns the focus.
  useEffect(() => {
    if (!pending) return;
    const onKey = (event: KeyboardEvent) => {
      if (!window.matchMedia("(min-width: 768px)").matches) return;
      const target = event.target instanceof Element ? event.target : null;
      const shortcut = reviewShortcut({
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        editable:
          target?.closest("input, textarea, select, [contenteditable='true'], [role='listbox']") !==
            null && target !== null,
      });
      if (!shortcut || rejectOpen) return;
      event.preventDefault();
      const current = drawerId ?? activeId;
      if (shortcut === "next" || shortcut === "prev") {
        const next = moveActive(ids, current, shortcut === "next" ? 1 : -1);
        setActiveId(next);
        if (drawerId !== null) setDrawerId(next);
        document
          .querySelector(`[data-submission-id="${next}"]`)
          ?.scrollIntoView({ block: "nearest" });
      } else if (current !== null) {
        if (shortcut === "approve") approveIds([current]);
        else {
          setDrawerId(current);
          setRejectOpen(true);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, ids, activeId, drawerId, rejectOpen, approveIds]);

  if (queue.isPending) {
    return (
      <div className="flex flex-col gap-2">
        {["a", "b", "c", "d", "e"].map((key) => (
          <Skeleton key={key} className="h-16 rounded-xl" />
        ))}
      </div>
    );
  }
  if (queue.isError) {
    return <p className="text-destructive-foreground text-sm">加载失败：{queue.error.message}</p>;
  }

  const { total } = queue.data;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const open = (id: number) => {
    setActiveId(id);
    setDrawerId(id);
  };

  return (
    <>
      {queue.data.rows.length === 0 ? (
        <Empty className="rounded-2xl border border-dashed py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <InboxIcon />
            </EmptyMedia>
            <EmptyTitle>{pending ? "队列已清空" : "暂无记录"}</EmptyTitle>
            <EmptyDescription>
              {pending ? "没有待审核的提交，新的提交会出现在这里。" : "这里还没有审核记录。"}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          {/* Desktop table */}
          <Card className="hidden overflow-hidden p-0 md:flex">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((group) => (
                  <TableRow key={group.id}>
                    {group.headers.map((header) => (
                      <TableHead key={header.id}>
                        {flexRender(header.column.columnDef.header, header.getContext())}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                <AnimatePresence initial={false}>
                  {table.getRowModel().rows.map((row, index) => (
                    <motion.tr
                      key={row.id}
                      layout="position"
                      data-submission-id={row.original.id}
                      data-state={row.getIsSelected() ? "selected" : undefined}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{
                        opacity: 1,
                        y: 0,
                        transition: { delay: Math.min(index, 12) * 0.02, ease },
                      }}
                      exit={{ opacity: 0, x: 24, transition: { duration: 0.18 } }}
                      onClick={() => open(row.original.id)}
                      className={cn(
                        "relative cursor-pointer border-b transition-colors last:border-b-0 hover:bg-accent/40 data-[state=selected]:bg-accent/60",
                        activeId === row.original.id &&
                          "shadow-[inset_3px_0_0_var(--color-primary)] bg-accent/30",
                      )}
                    >
                      {row.getAllCells().map((cell) => (
                        <TableCell key={cell.id}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </TableBody>
            </Table>
          </Card>

          {/* Mobile cards */}
          <ul className="flex flex-col gap-2 md:hidden">
            <AnimatePresence initial={false}>
              {table.getRowModel().rows.map((row, index) => (
                <motion.li
                  key={row.id}
                  layout="position"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{
                    opacity: 1,
                    y: 0,
                    transition: { delay: Math.min(index, 8) * 0.03, ease },
                  }}
                  exit={{ opacity: 0, height: 0, marginTop: 0, transition: { duration: 0.2 } }}
                >
                  <Card
                    className={cn(
                      "gap-3 p-3",
                      row.getIsSelected() && "border-primary/50 bg-accent/40",
                    )}
                  >
                    <div className="flex items-start gap-3">
                      {pending && (
                        <Checkbox
                          className="mt-3"
                          aria-label={`选择 @${row.original.username}`}
                          checked={row.getIsSelected()}
                          onCheckedChange={(checked) => row.toggleSelected(checked)}
                        />
                      )}
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => open(row.original.id)}
                      >
                        <Identity submission={row.original} />
                        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-muted-foreground text-xs">
                          <Badge variant="outline">{kindLabels[row.original.kind]}</Badge>
                          <Taxonomy submission={row.original} names={names} inline />
                          <span className="tabular-nums">
                            {compactNumber(row.original.fetchedMembers)} 成员
                          </span>
                          <span>{dateTime(row.original.reviewedAt ?? row.original.createdAt)}</span>
                        </div>
                      </button>
                    </div>
                    {pending ? (
                      <RowActions
                        wide
                        onApprove={() => approveIds([row.original.id])}
                        onReject={(reason) => rejectIds([row.original.id], reason)}
                      />
                    ) : row.original.status === "approved" ? (
                      <Badge variant="success" className="self-start">
                        已通过
                      </Badge>
                    ) : (
                      <Badge variant="error" className="self-start">
                        {rejectLabel(row.original.rejectReason)}
                      </Badge>
                    )}
                  </Card>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </>
      )}

      <div className="mt-4 flex items-center justify-between text-muted-foreground text-sm">
        <span>共 {total.toLocaleString("zh-CN")} 条</span>
        {pages > 1 && (
          <div className="flex items-center gap-2">
            <Button
              size="icon-sm"
              variant="outline"
              aria-label="上一页"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeftIcon />
            </Button>
            <span className="tabular-nums">
              {page} / {pages}
            </span>
            <Button
              size="icon-sm"
              variant="outline"
              aria-label="下一页"
              disabled={page >= pages}
              onClick={() => setPage(page + 1)}
            >
              <ChevronRightIcon />
            </Button>
          </div>
        )}
      </div>

      <AnimatePresence>
        {pending && selectedIds.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.22, ease }}
            className="fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-30 mx-auto flex max-w-xl flex-wrap items-center gap-2 rounded-2xl border bg-popover p-2 ps-4 shadow-lg md:bottom-6"
          >
            <span className="me-auto text-sm">
              已选 <b className="tabular-nums">{selectedIds.length}</b> 条
              {selectedIds.length > MAX_BULK && (
                <span className="text-warning-foreground">（单次最多 {MAX_BULK} 条）</span>
              )}
            </span>
            <Button size="sm" variant="ghost" onClick={() => setRowSelection({})}>
              取消
            </Button>
            <div className="flex w-full gap-2 *:flex-1 sm:w-auto sm:*:flex-none">
              <RejectSelect
                label="批量拒绝"
                className="sm:w-32"
                disabled={selectedIds.length > MAX_BULK}
                onReject={(reason) => rejectIds(selectedIds, reason)}
              />
              <Button
                disabled={selectedIds.length > MAX_BULK}
                onClick={() => approveIds(selectedIds)}
              >
                <CheckIcon aria-hidden />
                批量通过
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <SubmissionDrawer
        submission={drawerSubmission}
        names={names}
        rejectOpen={rejectOpen}
        onRejectOpenChange={setRejectOpen}
        onClose={() => {
          setDrawerId(null);
          setRejectOpen(false);
        }}
        onApprove={(id) => approveIds([id])}
        onReject={(id, reason) => rejectIds([id], reason)}
      />
    </>
  );
}

function Identity({ submission }: { submission: Submission }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar className="size-9 shrink-0">
        <AvatarFallback>{initial(submission)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <div className="max-w-64 truncate font-medium leading-5">
          {submission.fetchedTitle ?? submission.username}
        </div>
        <div className="truncate text-muted-foreground text-xs leading-5">
          @{submission.username}
        </div>
      </div>
    </div>
  );
}

function Taxonomy({
  submission,
  names,
  inline,
}: {
  submission: Submission;
  names: { category: (id: number) => string; tag: (id: number) => string };
  inline?: boolean;
}) {
  return (
    <span className={cn("flex items-center gap-1", !inline && "max-w-64 flex-wrap")}>
      <span className={inline ? undefined : "text-foreground"}>
        {names.category(submission.categoryId)}
      </span>
      {submission.tagIds.map((id) => (
        <Badge key={id} variant="secondary" size="sm">
          {names.tag(id)}
        </Badge>
      ))}
    </span>
  );
}

function RowActions({
  onApprove,
  onReject,
  wide,
}: {
  onApprove: () => void;
  onReject: (reason: RejectReason) => void;
  wide?: boolean;
}) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: only stops row-click propagation
    // biome-ignore lint/a11y/useKeyWithClickEvents: same
    <div
      className={cn("flex items-center justify-end gap-2", wide && "*:flex-1")}
      onClick={(event) => event.stopPropagation()}
    >
      <RejectSelect onReject={onReject} className={wide ? undefined : "h-8 w-24 sm:h-7"} />
      <Button size={wide ? "default" : "sm"} onClick={onApprove}>
        <CheckIcon aria-hidden />
        通过
        {!wide && <Kbd>A</Kbd>}
      </Button>
    </div>
  );
}

const rejectLabel = (reason: string | null) =>
  reason === null ? "已拒绝" : `已拒绝 · ${rejectReasonLabel(reason)}`;
