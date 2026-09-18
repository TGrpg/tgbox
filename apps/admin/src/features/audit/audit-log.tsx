import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ChevronRightIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/coss/ui/badge.tsx";
import { Button } from "@/components/coss/ui/button.tsx";
import { Card } from "@/components/coss/ui/card.tsx";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/coss/ui/select.tsx";
import { Skeleton } from "@/components/coss/ui/skeleton.tsx";
import { ActorChip } from "@/components/user-chip.tsx";
import {
  type AuditFilter,
  type AuditRow,
  auditActorsQueryOptions,
  auditQueryOptions,
} from "@/functions/audit.ts";
import { cn } from "@/lib/cn.ts";
import { auditActionLabel, auditActionOptions, isAuditAction } from "./labels.ts";

const ALL = "__all__";

const dateTime = (ms: number) =>
  new Date(ms).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

export function AuditLog() {
  const [filter, setFilter] = useState<AuditFilter>({});
  const actors = useQuery(auditActorsQueryOptions());
  const log = useInfiniteQuery(auditQueryOptions(filter));
  const rows = log.data?.pages.flatMap((page) => page.rows) ?? [];

  // Load the next page when the sentinel scrolls into view (button stays for keyboard/Mini App).
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = log;
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasNextPage) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting && !isFetchingNextPage) fetchNextPage();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const actionItems = [
    { value: ALL, label: "全部操作" },
    ...auditActionOptions.map((action) => ({ value: action, label: auditActionLabel(action) })),
  ];
  const actorItems = [
    { value: ALL, label: "全部操作者" },
    ...(actors.data ?? []).map((actor) => ({ value: actor, label: <ActorChip actor={actor} /> })),
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 sm:flex">
        <FilterSelect
          label="操作"
          items={actionItems}
          value={filter.action ?? ALL}
          onChange={(value) =>
            setFilter({ ...filter, action: isAuditAction(value) ? value : undefined })
          }
        />
        <FilterSelect
          label="操作者"
          items={actorItems}
          value={filter.actor ?? ALL}
          onChange={(value) => setFilter({ ...filter, actor: value === ALL ? undefined : value })}
        />
      </div>

      {log.isPending ? (
        <div className="flex flex-col gap-2">
          {["a", "b", "c", "d", "e"].map((key) => (
            <Skeleton key={key} className="h-14 rounded-xl" />
          ))}
        </div>
      ) : log.isError ? (
        <p className="text-destructive-foreground text-sm">加载失败：{log.error.message}</p>
      ) : rows.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground text-sm">没有记录</Card>
      ) : (
        <Card className="gap-0 overflow-hidden p-0">
          <AnimatePresence initial={false}>
            {rows.map((row, index) => (
              <motion.div
                key={row.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(index % 30, 10) * 0.015 }}
                className="border-b last:border-b-0"
              >
                <AuditItem row={row} />
              </motion.div>
            ))}
          </AnimatePresence>
        </Card>
      )}

      <div ref={sentinel} className="flex justify-center py-2">
        {log.hasNextPage ? (
          <Button
            variant="outline"
            size="sm"
            loading={log.isFetchingNextPage}
            onClick={() => log.fetchNextPage()}
          >
            加载更多
          </Button>
        ) : rows.length > 0 ? (
          <span className="text-muted-foreground text-xs">已经到底了</span>
        ) : null}
      </div>
    </div>
  );
}

function AuditItem({ row }: { row: AuditRow }) {
  const [open, setOpen] = useState(false);
  const expandable = row.payload !== null;
  const summary = (
    <>
      <ChevronRightIcon
        className={cn(
          "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform",
          open && "rotate-90",
          !expandable && "invisible",
        )}
        aria-hidden
      />
      <div className="grid min-w-0 flex-1 gap-1 sm:grid-cols-[9rem_8rem_1fr_auto] sm:items-center sm:gap-3">
        <span className="text-muted-foreground text-xs tabular-nums sm:order-4">
          {dateTime(row.createdAt)}
        </span>
        <span className="flex items-center gap-2 sm:order-1">
          <Badge variant={row.action.startsWith("build") ? "warning" : "secondary"}>
            {auditActionLabel(row.action)}
          </Badge>
        </span>
        <span className="truncate font-mono text-xs sm:order-2">{row.target ?? "—"}</span>
        <span className="min-w-0 text-muted-foreground text-xs sm:order-3">
          <ActorChip actor={row.actor} />
        </span>
      </div>
    </>
  );
  return (
    <div>
      {expandable ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-accent/40 sm:items-center"
        >
          {summary}
        </button>
      ) : (
        <div className="flex w-full items-start gap-2 px-3 py-2.5 sm:items-center">{summary}</div>
      )}
      <AnimatePresence initial={false}>
        {open && (
          <motion.pre
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden bg-muted/50 px-9 font-mono text-xs"
          >
            <div className="max-h-80 overflow-auto py-3">{row.payload}</div>
          </motion.pre>
        )}
      </AnimatePresence>
    </div>
  );
}

function FilterSelect({
  label,
  items,
  value,
  onChange,
}: {
  label: string;
  items: { value: string; label: ReactNode }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select items={items} value={value} onValueChange={(next) => onChange(next ?? ALL)}>
      <SelectTrigger aria-label={label} className="min-w-0 sm:w-48">
        <SelectValue />
      </SelectTrigger>
      <SelectPopup>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}
