import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SubmissionStatus } from "@tgbox/shared";
import { BanIcon, ExternalLinkIcon, MessageCircleIcon, SendIcon, UndoIcon } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/coss/ui/badge.tsx";
import { Button } from "@/components/coss/ui/button.tsx";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "@/components/coss/ui/sheet.tsx";
import { Skeleton } from "@/components/coss/ui/skeleton.tsx";
import { Textarea } from "@/components/coss/ui/textarea.tsx";
import { toastManager } from "@/components/coss/ui/toast.tsx";
import { useIsMobile } from "@/features/entries/use-is-mobile.ts";
import {
  formatAmount,
  orderStatusLabels,
  orderStatusVariants,
  productKindLabels,
} from "@/features/promotions/labels.ts";
import {
  $messageUser,
  $setUserBlacklisted,
  type UserDetail,
  userQueryOptions,
} from "@/functions/users.ts";
import { invalidate } from "@/lib/query-keys.ts";
import { displayName } from "./user-list.tsx";

const submissionLabels: Record<
  SubmissionStatus,
  { label: string; variant: "success" | "error" | "warning" }
> = {
  approved: { label: "通过", variant: "success" },
  rejected: { label: "拒绝", variant: "error" },
  pending: { label: "待审", variant: "warning" },
};

const date = (ms: number) => new Date(ms).toLocaleDateString("zh-CN");

export function UserSheet({ userId, onClose }: { userId: number | null; onClose: () => void }) {
  const mobile = useIsMobile();
  return (
    <Sheet open={userId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetPopup side={mobile ? "bottom" : "right"} className="md:max-w-lg">
        {userId !== null && <UserPanel key={userId} userId={userId} />}
      </SheetPopup>
    </Sheet>
  );
}

function UserPanel({ userId }: { userId: number }) {
  const view = useQuery(userQueryOptions(userId));
  if (view.isPending) {
    return (
      <SheetPanel className="flex flex-col gap-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-40" />
      </SheetPanel>
    );
  }
  if (view.isError || !view.data) {
    return (
      <SheetPanel>
        <p className="text-destructive-foreground text-sm">
          {view.isError ? `加载失败：${view.error.message}` : "找不到这个用户"}
        </p>
      </SheetPanel>
    );
  }
  return <UserDetailView user={view.data} />;
}

function UserDetailView({ user }: { user: UserDetail }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");

  const ban = useMutation({
    mutationFn: (blacklisted: boolean) =>
      $setUserBlacklisted({ data: { id: user.tgUserId, blacklisted } }),
    onSuccess: (_changed, blacklisted) =>
      toastManager.add({ type: "success", title: blacklisted ? "已拉黑" : "已解除拉黑" }),
    onError: (error) =>
      toastManager.add({ type: "error", title: "操作失败", description: error.message }),
    onSettled: () => invalidate(queryClient, "users", "blacklist", "audit"),
  });

  const send = useMutation({
    mutationFn: () =>
      $messageUser({
        data: { id: user.tgUserId, message: { text, buttonText: null, buttonUrl: null } },
      }),
    onSuccess: (result) => {
      if (result.ok) {
        setText("");
        toastManager.add({ type: "success", title: "已发送" });
      } else {
        toastManager.add({
          type: "error",
          title:
            result.error === "blocked"
              ? "对方已屏蔽机器人"
              : result.error === "invalid"
                ? "消息不能为空"
                : "发送失败",
        });
      }
    },
    onError: (error) =>
      toastManager.add({ type: "error", title: "发送失败", description: error.message }),
    onSettled: () => invalidate(queryClient, "users", "audit"),
  });

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex flex-wrap items-center gap-2">
          {displayName(user)}
          {user.blacklisted && <Badge variant="error">已拉黑</Badge>}
          {user.blockedAt !== null && <Badge variant="secondary">已屏蔽机器人</Badge>}
        </SheetTitle>
        <SheetDescription>
          {user.username ? (
            <a
              href={`https://t.me/${user.username}`}
              target="_blank"
              rel="noopener"
              className="underline-offset-2 hover:underline"
            >
              @{user.username}
            </a>
          ) : (
            "没有用户名"
          )}
          {" · "}
          <span className="font-mono">{user.tgUserId}</span>
          {" · 首次使用 "}
          {date(user.firstSeenAt)}
          {" · 最近活跃 "}
          {user.lastSeenDay}
        </SheetDescription>
      </SheetHeader>
      <SheetPanel className="flex flex-col gap-6">
        <div className="flex flex-wrap gap-2">
          <Button
            variant={user.blacklisted ? "outline" : "destructive-outline"}
            size="sm"
            loading={ban.isPending}
            onClick={() => ban.mutate(!user.blacklisted)}
          >
            {user.blacklisted ? <UndoIcon aria-hidden /> : <BanIcon aria-hidden />}
            {user.blacklisted ? "解除拉黑" : "拉黑"}
          </Button>
          {user.supportUrl && (
            <Button
              variant="outline"
              size="sm"
              render={<a href={user.supportUrl} target="_blank" rel="noopener" />}
            >
              <MessageCircleIcon aria-hidden />
              客服话题
              <ExternalLinkIcon aria-hidden />
            </Button>
          )}
        </div>

        <section className="flex flex-col gap-2">
          <h3 className="font-medium text-sm">私信</h3>
          <Textarea
            aria-label="消息内容"
            placeholder={
              user.blockedAt !== null ? "对方已屏蔽机器人，消息发不出去" : "以机器人身份发一条消息"
            }
            value={text}
            maxLength={4096}
            onChange={(event) => setText(event.target.value)}
          />
          <Button
            size="sm"
            className="self-end"
            disabled={!text.trim()}
            loading={send.isPending}
            onClick={() => send.mutate()}
          >
            <SendIcon aria-hidden />
            发送
          </Button>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="font-medium text-sm">投稿（最近 20 条）</h3>
          {user.submissions.length === 0 ? (
            <p className="text-muted-foreground text-sm">没有投稿</p>
          ) : (
            <ul className="flex flex-col divide-y rounded-xl border">
              {user.submissions.map((item) => {
                const status = submissionLabels[item.status];
                return (
                  <li key={item.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">@{item.username}</span>
                    <Badge variant={status.variant}>{status.label}</Badge>
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {date(item.createdAt)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="font-medium text-sm">订单（最近 20 条）</h3>
          {user.orders.length === 0 ? (
            <p className="text-muted-foreground text-sm">没有订单</p>
          ) : (
            <ul className="flex flex-col divide-y rounded-xl border">
              {user.orders.map((order) => (
                <li key={order.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    {productKindLabels[order.kind]} {order.days} 天
                    {order.targetUsername ? ` · @${order.targetUsername}` : ""}
                  </span>
                  <span className="tabular-nums">{formatAmount(order.amount, order.currency)}</span>
                  <Badge variant={orderStatusVariants[order.status]}>
                    {orderStatusLabels[order.status]}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </section>
      </SheetPanel>
    </>
  );
}
