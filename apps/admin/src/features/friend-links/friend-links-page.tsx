import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FriendLink, MAX_FRIEND_LINKS } from "@tgbox/shared";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  HandshakeIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/coss/ui/badge.tsx";
import { Button } from "@/components/coss/ui/button.tsx";
import { Card } from "@/components/coss/ui/card.tsx";
import { Skeleton } from "@/components/coss/ui/skeleton.tsx";
import { toastManager } from "@/components/coss/ui/toast.tsx";
import { LinkListEditor } from "@/components/link-list-editor.tsx";
import { UserChip } from "@/components/user-chip.tsx";
import {
  $reviewFriendLink,
  $saveFriendLinks,
  FRIEND_LINK_REQUESTS_PAGE_SIZE,
  type FriendLinkRequestRow,
  friendLinkRequestsQueryOptions,
  friendLinksQueryOptions,
} from "@/functions/friend-links.ts";
import { invalidate } from "@/lib/query-keys.ts";

const dateTime = (ms: number) =>
  new Date(ms).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" });

const statusBadge = {
  pending: <Badge variant="warning">待审核</Badge>,
  approved: <Badge variant="success">已通过</Badge>,
  rejected: <Badge variant="secondary">已拒绝</Badge>,
} as const;

export function FriendLinksPage() {
  return (
    <div className="flex flex-col gap-6">
      <Requests />
      <LinksEditor />
    </div>
  );
}

/* ---------------------------------------------------------------- requests */

function Requests() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const list = useQuery(friendLinkRequestsQueryOptions(page));
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / FRIEND_LINK_REQUESTS_PAGE_SIZE));

  const review = useMutation({
    mutationFn: (data: { id: number; approve: boolean }) => $reviewFriendLink({ data }),
    onSuccess: (result, { approve }) => {
      if (result === "ok") {
        toastManager.add({
          type: "success",
          title: approve ? "已通过，网站几分钟后更新" : "已拒绝",
          description: "已私信通知申请人",
        });
      } else {
        toastManager.add({
          type: "error",
          title: result === "full" ? `友链已满（${MAX_FRIEND_LINKS} 个）` : "该申请已被处理",
        });
      }
    },
    onError: (error) =>
      toastManager.add({ type: "error", title: "操作失败", description: error.message }),
    onSettled: () =>
      invalidate(queryClient, "friendLinkRequests", "friendLinks", "audit", "dashboardActivity"),
  });

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-semibold text-base">申请</h2>
      {list.isPending ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : list.isError ? (
        <p className="text-destructive-foreground text-sm">加载失败：{list.error.message}</p>
      ) : list.data.rows.length === 0 ? (
        <Card className="items-center gap-2 p-10 text-center text-muted-foreground text-sm">
          <HandshakeIcon className="size-6" aria-hidden />
          还没有友链申请。网站页脚和 /links/ 页的「申请友链」按钮会打开机器人。
        </Card>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {list.data.rows.map((row) => (
              <RequestCard
                key={row.id}
                row={row}
                pending={review.isPending && review.variables?.id === row.id}
                onReview={(approve) => review.mutate({ id: row.id, approve })}
              />
            ))}
          </div>
          {pages > 1 && (
            <div className="flex items-center justify-end gap-2 text-muted-foreground text-sm">
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
        </>
      )}
    </section>
  );
}

function RequestCard({
  row,
  pending,
  onReview,
}: {
  row: FriendLinkRequestRow;
  pending: boolean;
  onReview: (approve: boolean) => void;
}) {
  return (
    <Card className="gap-3 p-4 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{row.name}</span>
          {statusBadge[row.status]}
          <Badge variant={row.backlink ? "info" : "outline"}>
            {row.backlink ? "首页有回链" : "未发现回链"}
          </Badge>
        </div>
        <a
          href={row.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-flex max-w-full items-center gap-1 break-all text-primary text-sm hover:underline"
        >
          {row.url}
          <ExternalLinkIcon className="size-3.5 shrink-0" aria-hidden />
        </a>
        <p className="mt-1 text-muted-foreground text-sm">{row.description}</p>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-muted-foreground text-xs">
          <UserChip id={row.tgUserId} size="sm" showId />
          <span className="tabular-nums">{dateTime(row.createdAt)}</span>
        </div>
      </div>
      {row.status === "pending" && (
        <div className="flex shrink-0 gap-2">
          <Button size="sm" loading={pending} onClick={() => onReview(true)}>
            <CheckIcon aria-hidden />
            通过
          </Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => onReview(false)}>
            <XIcon aria-hidden />
            拒绝
          </Button>
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ editor */

function LinksEditor() {
  const queryClient = useQueryClient();
  const saved = useQuery(friendLinksQueryOptions());
  const save = useMutation({
    mutationFn: (next: FriendLink[]) => $saveFriendLinks({ data: { links: next } }),
    onSuccess: ({ changed }) =>
      toastManager.add({
        type: "success",
        title: changed ? "已保存，网站几分钟后更新" : "没有变化",
      }),
    onError: (error) =>
      toastManager.add({ type: "error", title: "保存失败", description: error.message }),
    onSettled: () => invalidate(queryClient, "friendLinks", "audit", "dashboardActivity"),
  });

  if (saved.isPending) return <Skeleton className="h-64 rounded-2xl" />;
  if (saved.isError) {
    return <p className="text-destructive-foreground text-sm">加载失败：{saved.error.message}</p>;
  }
  return (
    <LinkListEditor
      key={JSON.stringify(saved.data)}
      initial={saved.data}
      title="友情链接"
      hint="按顺序显示：页脚展示前 12 个，/links/ 页展示全部。简介留空则只显示名称。"
      emptyText="还没有友情链接。"
      maxLinks={MAX_FRIEND_LINKS}
      saving={save.isPending}
      onSave={(links) => save.mutate(links)}
    />
  );
}
