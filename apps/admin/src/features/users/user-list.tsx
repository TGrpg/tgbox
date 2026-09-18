import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeftIcon, ChevronRightIcon, SearchIcon, UsersIcon } from "lucide-react";
import { useEffect, useState } from "react";
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
import { formatAmount } from "@/features/promotions/labels.ts";
import {
  USERS_PAGE_SIZE,
  type UserRow,
  type UsersQuery,
  usersQueryOptions,
} from "@/functions/users.ts";
import { UserSheet } from "./user-sheet.tsx";

type Filter = UsersQuery["filter"];

const filterItems: { value: Filter; label: string }[] = [
  { value: "all", label: "全部用户" },
  { value: "submitters", label: "有投稿" },
  { value: "paying", label: "付费用户" },
  { value: "blacklisted", label: "已拉黑" },
  { value: "blocked", label: "已屏蔽机器人" },
];

export const displayName = (user: Pick<UserRow, "firstName" | "lastName" | "tgUserId">) =>
  [user.firstName, user.lastName].filter(Boolean).join(" ") || `用户 ${user.tgUserId}`;

export const formatSpend = (spend: UserRow["spend"]) =>
  spend.length === 0
    ? "—"
    : spend
        .map((item) => formatAmount(String(Number(item.amount.toFixed(2))), item.currency))
        .join(" + ");

function StatusBadges({ user }: { user: UserRow }) {
  return (
    <>
      {user.blacklisted && <Badge variant="error">已拉黑</Badge>}
      {user.blockedAt !== null && <Badge variant="secondary">已屏蔽机器人</Badge>}
    </>
  );
}

function Submissions({ counts }: { counts: UserRow["submissions"] }) {
  const total = counts.approved + counts.rejected + counts.pending;
  if (total === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="tabular-nums">
      <span className="text-success-foreground">{counts.approved}</span>
      {" / "}
      <span className="text-destructive-foreground">{counts.rejected}</span>
      {counts.pending > 0 && (
        <span className="text-warning-foreground"> · {counts.pending} 待审</span>
      )}
    </span>
  );
}

export function UserList() {
  const [filter, setFilter] = useState<Filter>("all");
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<number | null>(null);

  // Search on pause, not per keystroke: every query scans the user table on live D1.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(typed.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [typed]);

  const list = useQuery({
    ...usersQueryOptions({ page, filter, search }),
    placeholderData: keepPreviousData,
  });
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / USERS_PAGE_SIZE));

  return (
    <div className="flex flex-col gap-4">
      <Card className="grid gap-2 p-3 sm:grid-cols-[12rem_1fr]">
        <Select
          items={filterItems}
          value={filter}
          onValueChange={(next) => {
            if (!next) return;
            setFilter(next);
            setPage(1);
          }}
        >
          <SelectTrigger aria-label="筛选">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {filterItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <div className="relative">
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            aria-label="搜索用户"
            placeholder="用户 ID、@用户名或名字"
            className="*:[input]:ps-9"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
          />
        </div>
      </Card>

      {list.isPending ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : list.isError ? (
        <p className="text-destructive-foreground text-sm">加载失败：{list.error.message}</p>
      ) : list.data.rows.length === 0 ? (
        <Card className="items-center gap-2 p-10 text-center text-muted-foreground text-sm">
          <UsersIcon className="size-6" aria-hidden />
          {search || filter !== "all" ? "没有符合条件的用户" : "还没有用户"}
        </Card>
      ) : (
        <>
          <Card className="hidden overflow-hidden p-0 md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">用户</TableHead>
                  <TableHead>语言</TableHead>
                  <TableHead>投稿（通过 / 拒绝）</TableHead>
                  <TableHead>订单 · 消费</TableHead>
                  <TableHead>首次使用</TableHead>
                  <TableHead className="pr-4">最近活跃</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.rows.map((user) => (
                  <TableRow
                    key={user.tgUserId}
                    className="cursor-pointer"
                    onClick={() => setOpen(user.tgUserId)}
                  >
                    <TableCell className="pl-4">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{displayName(user)}</span>
                        <StatusBadges user={user} />
                      </div>
                      <div className="text-muted-foreground text-xs">
                        {user.username ? `@${user.username} · ` : ""}
                        <span className="font-mono">{user.tgUserId}</span>
                      </div>
                    </TableCell>
                    <TableCell>{user.locale === "en" ? "English" : "中文"}</TableCell>
                    <TableCell>
                      <Submissions counts={user.submissions} />
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {user.orders > 0 ? `${user.orders} · ${formatSpend(user.spend)}` : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {new Date(user.firstSeenAt).toLocaleDateString("zh-CN")}
                    </TableCell>
                    <TableCell className="pr-4 text-muted-foreground tabular-nums">
                      {user.lastSeenDay}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <div className="flex flex-col gap-2 md:hidden">
            {list.data.rows.map((user) => (
              <Card
                key={user.tgUserId}
                render={<button type="button" onClick={() => setOpen(user.tgUserId)} />}
                className="gap-1 p-3 text-left"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{displayName(user)}</span>
                  <StatusBadges user={user} />
                </div>
                <div className="text-muted-foreground text-xs">
                  {user.username ? `@${user.username} · ` : ""}
                  活跃 {user.lastSeenDay}
                </div>
                <div className="flex gap-4 text-xs">
                  <span>
                    投稿 <Submissions counts={user.submissions} />
                  </span>
                  {user.orders > 0 && <span>消费 {formatSpend(user.spend)}</span>}
                </div>
              </Card>
            ))}
          </div>
          <div className="flex items-center justify-between text-muted-foreground text-sm">
            <span>共 {total.toLocaleString("zh-CN")} 人</span>
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
      <UserSheet userId={open} onClose={() => setOpen(null)} />
    </div>
  );
}
