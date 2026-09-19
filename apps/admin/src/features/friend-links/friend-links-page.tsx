import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FriendLink, FriendLink as FriendLinkSchema, MAX_FRIEND_LINKS } from "@tgbox/shared";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  HandshakeIcon,
  PlusIcon,
  SaveIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/coss/ui/badge.tsx";
import { Button } from "@/components/coss/ui/button.tsx";
import { Card } from "@/components/coss/ui/card.tsx";
import { Input } from "@/components/coss/ui/input.tsx";
import { Skeleton } from "@/components/coss/ui/skeleton.tsx";
import { toastManager } from "@/components/coss/ui/toast.tsx";
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

const blank: FriendLink = { name: "", url: "https://", descZh: "", descEn: "" };

function LinksEditor() {
  const queryClient = useQueryClient();
  const saved = useQuery(friendLinksQueryOptions());
  const [links, setLinks] = useState<FriendLink[] | null>(null);
  // Follow the server until the admin starts editing (an approval adds rows underneath).
  useEffect(() => {
    if (saved.data && links === null) setLinks(saved.data);
  }, [saved.data, links]);

  const save = useMutation({
    mutationFn: (next: FriendLink[]) => $saveFriendLinks({ data: { links: next } }),
    onSuccess: ({ changed }) =>
      toastManager.add({
        type: "success",
        title: changed ? "已保存，网站几分钟后更新" : "没有变化",
      }),
    onError: (error) =>
      toastManager.add({ type: "error", title: "保存失败", description: error.message }),
    onSettled: async () => {
      await invalidate(queryClient, "friendLinks", "audit", "dashboardActivity");
      setLinks(null);
    },
  });

  if (saved.isPending || links === null) return <Skeleton className="h-64 rounded-2xl" />;
  if (saved.isError) {
    return <p className="text-destructive-foreground text-sm">加载失败：{saved.error.message}</p>;
  }

  const cleaned = links.map((link) => ({
    name: link.name.trim(),
    url: link.url.trim(),
    descZh: link.descZh.trim(),
    descEn: link.descEn.trim(),
  }));
  const invalid = cleaned.map((link) => !FriendLinkSchema.safeParse(link).success);
  const dirty = JSON.stringify(cleaned) !== JSON.stringify(saved.data);
  const update = (index: number, patch: Partial<FriendLink>) =>
    setLinks(links.map((link, i) => (i === index ? { ...link, ...patch } : link)));
  const move = (index: number, by: -1 | 1) => {
    const next = [...links];
    const [item] = next.splice(index, 1);
    if (item) next.splice(index + by, 0, item);
    setLinks(next);
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold text-base">
          友情链接
          <span className="ms-2 font-normal text-muted-foreground text-sm tabular-nums">
            {links.length} / {MAX_FRIEND_LINKS}
          </span>
        </h2>
        <p className="basis-full text-muted-foreground text-sm sm:order-last">
          按顺序显示：页脚展示前 12 个，/links/ 页展示全部。简介留空则只显示名称。
        </p>
        <div className="ms-auto flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={links.length >= MAX_FRIEND_LINKS}
            onClick={() => setLinks([...links, blank])}
          >
            <PlusIcon aria-hidden />
            添加
          </Button>
          <Button
            size="sm"
            disabled={!dirty || invalid.some(Boolean)}
            loading={save.isPending}
            onClick={() => save.mutate(cleaned)}
          >
            <SaveIcon aria-hidden />
            保存
          </Button>
        </div>
      </div>
      {links.length === 0 ? (
        <Card className="items-center p-10 text-center text-muted-foreground text-sm">
          还没有友情链接。
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {links.map((link, index) => (
            <Card
              // biome-ignore lint/suspicious/noArrayIndexKey: rows have no id; order is the data.
              key={index}
              className="grid gap-2 p-3 sm:grid-cols-[1fr_1.4fr_auto]"
              data-invalid={invalid[index] || undefined}
            >
              <Input
                aria-label="名称"
                placeholder="名称"
                maxLength={40}
                value={link.name}
                onChange={(event) => update(index, { name: event.target.value })}
              />
              <Input
                aria-label="网址"
                placeholder="https://"
                maxLength={200}
                value={link.url}
                aria-invalid={invalid[index] && !link.url.startsWith("https://") ? true : undefined}
                onChange={(event) => update(index, { url: event.target.value })}
              />
              <div className="row-span-2 flex items-start justify-end gap-1 sm:flex-col">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="上移"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUpIcon />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="下移"
                  disabled={index === links.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDownIcon />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`删除 ${link.name}`}
                  onClick={() => setLinks(links.filter((_, i) => i !== index))}
                >
                  <Trash2Icon />
                </Button>
              </div>
              <Input
                aria-label="中文简介"
                placeholder="中文简介（可选）"
                maxLength={120}
                value={link.descZh}
                onChange={(event) => update(index, { descZh: event.target.value })}
              />
              <Input
                aria-label="英文简介"
                placeholder="English description (optional)"
                maxLength={120}
                value={link.descEn}
                onChange={(event) => update(index, { descEn: event.target.value })}
              />
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
