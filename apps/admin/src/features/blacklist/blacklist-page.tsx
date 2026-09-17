import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BanIcon, ChevronLeftIcon, ChevronRightIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type FormEvent, useEffect, useState } from "react";
import { Badge } from "@/components/coss/ui/badge.tsx";
import { Button } from "@/components/coss/ui/button.tsx";
import { Card } from "@/components/coss/ui/card.tsx";
import { Input } from "@/components/coss/ui/input.tsx";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/coss/ui/select.tsx";
import { Skeleton } from "@/components/coss/ui/skeleton.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/coss/ui/table.tsx";
import { toastManager } from "@/components/coss/ui/toast.tsx";
import {
  $addBlacklist,
  $removeBlacklist,
  BLACKLIST_PAGE_SIZE,
  type BlacklistPageData,
  type BlacklistRow,
  blacklistQueryOptions,
} from "@/functions/blacklist.ts";
import { invalidate } from "@/lib/query-keys.ts";

type BlacklistType = BlacklistRow["type"];

const typeItems: { value: BlacklistType; label: string }[] = [
  { value: "username", label: "用户名 / 频道" },
  { value: "user", label: "用户 ID" },
];
const typeLabel = (type: BlacklistType) => (type === "user" ? "用户 ID" : "用户名");

const dateTime = (ms: number) =>
  new Date(ms).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" });

const rowKey = (row: Pick<BlacklistRow, "type" | "value">) => `${row.type}:${row.value}`;

export function BlacklistPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const list = useQuery(blacklistQueryOptions(page));
  const { queryKey } = blacklistQueryOptions(page);
  const settle = () => invalidate(queryClient, "blacklist", "audit", "dashboardActivity");

  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / BLACKLIST_PAGE_SIZE));
  // Removing the last row of the last page would otherwise strand the admin on an empty page.
  // Only once the page has loaded: while a page is in flight `total` is 0 and would reset paging.
  useEffect(() => {
    if (list.data && page > pages) setPage(pages);
  }, [list.data, page, pages]);

  const add = useMutation({
    mutationFn: (data: { type: BlacklistType; value: string; reason: string }) =>
      $addBlacklist({ data }),
    onSuccess: (result) => {
      if (result.ok) toastManager.add({ type: "success", title: `已拉黑 ${result.value}` });
      else
        toastManager.add({
          type: "error",
          title: result.error === "exists" ? "已在黑名单中" : "格式不正确",
          description:
            result.error === "invalid"
              ? "用户 ID 为纯数字；用户名可填 @name 或 t.me 链接"
              : undefined,
        });
    },
    onError: (error) =>
      toastManager.add({ type: "error", title: "操作失败", description: error.message }),
    onSettled: settle,
  });

  const remove = useMutation({
    mutationFn: (row: Pick<BlacklistRow, "type" | "value">) =>
      $removeBlacklist({ data: { type: row.type, value: row.value } }),
    onMutate: async (row) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData(queryKey);
      queryClient.setQueryData(
        queryKey,
        (old: BlacklistPageData | undefined) =>
          old && {
            rows: old.rows.filter((item) => rowKey(item) !== rowKey(row)),
            total: Math.max(0, old.total - 1),
          },
      );
      return { previous };
    },
    onSuccess: (_removed, row) =>
      toastManager.add({ type: "success", title: `已移出黑名单：${row.value}` }),
    onError: (error, _row, context) => {
      if (context) queryClient.setQueryData(queryKey, context.previous);
      toastManager.add({ type: "error", title: "操作失败", description: error.message });
    },
    onSettled: settle,
  });

  return (
    <div className="flex flex-col gap-4">
      <AddForm
        pending={add.isPending}
        onSubmit={(data, reset) => add.mutate(data, { onSuccess: (r) => r.ok && reset() })}
      />
      {list.isPending ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : list.isError ? (
        <p className="text-destructive-foreground text-sm">加载失败：{list.error.message}</p>
      ) : list.data.rows.length === 0 ? (
        <Card className="items-center gap-2 p-10 text-center text-muted-foreground text-sm">
          <BanIcon className="size-6" aria-hidden />
          黑名单为空
        </Card>
      ) : (
        <>
          <Card className="hidden overflow-hidden p-0 md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">类型</TableHead>
                  <TableHead>值</TableHead>
                  <TableHead>原因</TableHead>
                  <TableHead>加入时间</TableHead>
                  <TableHead className="pr-4 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <AnimatePresence initial={false}>
                  {list.data.rows.map((row) => (
                    <motion.tr
                      key={rowKey(row)}
                      layout="position"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="border-b last:border-b-0"
                    >
                      <TableCell className="pl-4">
                        <Badge variant={row.type === "user" ? "info" : "secondary"}>
                          {typeLabel(row.type)}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono">{row.value}</TableCell>
                      <TableCell className="max-w-72 truncate text-muted-foreground">
                        {row.reason ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground tabular-nums">
                        {dateTime(row.createdAt)}
                      </TableCell>
                      <TableCell className="pr-4 text-right">
                        <Button size="sm" variant="ghost" onClick={() => remove.mutate(row)}>
                          <Trash2Icon aria-hidden />
                          移除
                        </Button>
                      </TableCell>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </TableBody>
            </Table>
          </Card>
          <div className="flex flex-col gap-2 md:hidden">
            <AnimatePresence initial={false}>
              {list.data.rows.map((row) => (
                <motion.div
                  key={rowKey(row)}
                  layout="position"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  <Card className="flex-row items-center gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Badge variant={row.type === "user" ? "info" : "secondary"}>
                          {typeLabel(row.type)}
                        </Badge>
                        <span className="truncate font-mono text-sm">{row.value}</span>
                      </div>
                      <div className="mt-1 truncate text-muted-foreground text-xs">
                        {row.reason ? `${row.reason} · ` : ""}
                        {dateTime(row.createdAt)}
                      </div>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`移除 ${row.value}`}
                      onClick={() => remove.mutate(row)}
                    >
                      <Trash2Icon aria-hidden />
                    </Button>
                  </Card>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
          <div className="flex items-center justify-between text-muted-foreground text-sm">
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
        </>
      )}
    </div>
  );
}

function AddForm({
  pending,
  onSubmit,
}: {
  pending: boolean;
  onSubmit: (
    data: { type: BlacklistType; value: string; reason: string },
    reset: () => void,
  ) => void;
}) {
  const [type, setType] = useState<BlacklistType>("username");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit({ type, value, reason }, () => {
      setValue("");
      setReason("");
    });
  };
  return (
    <Card className="p-3">
      <form onSubmit={submit} className="grid gap-2 sm:grid-cols-[10rem_1fr_1fr_auto]">
        <Select items={typeItems} value={type} onValueChange={(next) => next && setType(next)}>
          <SelectTrigger aria-label="类型">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {typeItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <Input
          aria-label="值"
          placeholder={
            type === "user" ? "Telegram 用户 ID，如 123456789" : "@username 或 t.me 链接"
          }
          inputMode={type === "user" ? "numeric" : "text"}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          required
        />
        <Input
          aria-label="原因"
          placeholder="原因（可选）"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={200}
        />
        <Button type="submit" loading={pending}>
          <PlusIcon aria-hidden />
          加入黑名单
        </Button>
      </form>
    </Card>
  );
}
