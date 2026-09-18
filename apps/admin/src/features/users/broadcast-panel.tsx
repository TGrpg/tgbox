import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BroadcastAudience } from "@tgbox/shared";
import { EyeIcon, PauseIcon, PlayIcon, SendIcon, SquareIcon } from "lucide-react";
import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/coss/ui/alert-dialog.tsx";
import { Badge } from "@/components/coss/ui/badge.tsx";
import { Button } from "@/components/coss/ui/button.tsx";
import { Card } from "@/components/coss/ui/card.tsx";
import { Input } from "@/components/coss/ui/input.tsx";
import { Label } from "@/components/coss/ui/label.tsx";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/coss/ui/select.tsx";
import { Skeleton } from "@/components/coss/ui/skeleton.tsx";
import { Textarea } from "@/components/coss/ui/textarea.tsx";
import { toastManager } from "@/components/coss/ui/toast.tsx";
import { dateTime } from "@/features/promotions/labels.ts";
import {
  $advanceBroadcast,
  $createBroadcast,
  $previewBroadcast,
  $setBroadcastState,
  audienceQueryOptions,
  type BroadcastRow,
  broadcastsQueryOptions,
} from "@/functions/users.ts";
import { invalidate } from "@/lib/query-keys.ts";

const audienceItems: { value: BroadcastAudience; label: string }[] = [
  { value: "all", label: "全部用户" },
  { value: "zh", label: "中文用户" },
  { value: "en", label: "英文用户" },
  { value: "paying", label: "付费用户" },
];
const audienceLabel = (value: BroadcastAudience) =>
  audienceItems.find((item) => item.value === value)?.label ?? value;

const statusBadges: Record<
  BroadcastRow["status"],
  { label: string; variant: "info" | "warning" | "success" | "secondary" }
> = {
  running: { label: "发送中", variant: "info" },
  paused: { label: "已暂停", variant: "warning" },
  done: { label: "已完成", variant: "success" },
  cancelled: { label: "已取消", variant: "secondary" },
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * While this page is open, a running broadcast is pushed batch after batch (each call sends up to
 * 40 messages at Telegram's pace). Closing the page just hands it back to the 5-minute cron.
 */
function useBroadcastDriver(running: BroadcastRow | undefined) {
  const queryClient = useQueryClient();
  const { queryKey } = broadcastsQueryOptions();
  const id = running?.id;
  useEffect(() => {
    if (id === undefined) return;
    let stopped = false;
    (async () => {
      let current = queryClient.getQueryData(queryKey)?.find((row) => row.id === id);
      while (!stopped && current?.status === "running") {
        // Telegram's back-off, or another sender's lease (the cron mid-batch).
        const wait = current.notBefore - Date.now();
        await sleep(Math.min(Math.max(wait, 250), 10_000));
        if (stopped) break;
        const next = await $advanceBroadcast({ data: { id } });
        if (!next) break;
        current = next;
        queryClient.setQueryData(queryKey, (rows) =>
          rows?.map((row) => (row.id === next.id ? next : row)),
        );
      }
      if (!stopped) await invalidate(queryClient, "users", "audit");
    })().catch((error: unknown) =>
      toastManager.add({
        type: "error",
        title: "群发中断，将由定时任务继续",
        description: error instanceof Error ? error.message : undefined,
      }),
    );
    return () => {
      stopped = true;
    };
  }, [id, queryClient, queryKey]);
}

export function BroadcastPanel() {
  const history = useQuery(broadcastsQueryOptions());
  const running = history.data?.find((row) => row.status === "running");
  useBroadcastDriver(running);

  return (
    <div className="flex flex-col gap-4">
      <Composer busy={running !== undefined} />
      {history.isPending ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : history.isError ? (
        <p className="text-destructive-foreground text-sm">加载失败：{history.error.message}</p>
      ) : (
        history.data.map((row) => <BroadcastCard key={row.id} broadcast={row} />)
      )}
    </div>
  );
}

function Composer({ busy }: { busy: boolean }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [buttonText, setButtonText] = useState("");
  const [buttonUrl, setButtonUrl] = useState("");
  const [audience, setAudience] = useState<BroadcastAudience>("all");
  const count = useQuery(audienceQueryOptions(audience));

  const withButton = buttonText.trim() !== "" || buttonUrl.trim() !== "";
  const buttonOk =
    !withButton || (buttonText.trim() !== "" && /^https:\/\/\S+$/.test(buttonUrl.trim()));
  const message = {
    text,
    buttonText: withButton ? buttonText.trim() : null,
    buttonUrl: withButton ? buttonUrl.trim() : null,
  };
  const ready = text.trim() !== "" && buttonOk;

  const preview = useMutation({
    mutationFn: () => $previewBroadcast({ data: { message } }),
    onSuccess: (result) =>
      result.ok
        ? toastManager.add({ type: "success", title: "已发到你的 Telegram，先看看效果" })
        : toastManager.add({
            type: "error",
            title:
              result.error === "no_admin_id"
                ? "没有可预览的管理员 Telegram ID（ADMIN_IDS）"
                : result.error === "blocked"
                  ? "你屏蔽了机器人，先在 Telegram 里解除"
                  : "预览发送失败",
          }),
    onError: (error) =>
      toastManager.add({ type: "error", title: "预览发送失败", description: error.message }),
  });

  const start = useMutation({
    mutationFn: () => $createBroadcast({ data: { message, audience } }),
    onSuccess: (result) => {
      if (result.ok) {
        setText("");
        setButtonText("");
        setButtonUrl("");
        toastManager.add({ type: "success", title: `开始群发，共 ${result.broadcast.total} 人` });
      } else {
        toastManager.add({
          type: "error",
          title: result.error === "empty" ? "这个范围里没有可发送的用户" : "消息内容不符合要求",
        });
      }
    },
    onError: (error) =>
      toastManager.add({ type: "error", title: "群发失败", description: error.message }),
    onSettled: () => invalidate(queryClient, "users", "audit"),
  });

  return (
    <Card className="gap-4 p-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="broadcast-text">消息内容</Label>
        <Textarea
          id="broadcast-text"
          placeholder="纯文本，最多 4096 字。链接会自动识别。"
          value={text}
          maxLength={4096}
          onChange={(event) => setText(event.target.value)}
          className="min-h-32"
        />
      </div>
      <div className="grid gap-2 sm:grid-cols-[12rem_1fr]">
        <Input
          aria-label="按钮文字"
          placeholder="按钮文字（可选）"
          value={buttonText}
          maxLength={40}
          onChange={(event) => setButtonText(event.target.value)}
        />
        <Input
          aria-label="按钮链接"
          placeholder="按钮链接，https:// 开头"
          value={buttonUrl}
          onChange={(event) => setButtonUrl(event.target.value)}
          aria-invalid={!buttonOk || undefined}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          items={audienceItems}
          value={audience}
          onValueChange={(next) => next && setAudience(next)}
        >
          <SelectTrigger aria-label="发送范围" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {audienceItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <span className="text-muted-foreground text-sm tabular-nums">
          {count.data === undefined ? "…" : `${count.data.toLocaleString("zh-CN")} 人可送达`}
        </span>
        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            disabled={!ready}
            loading={preview.isPending}
            onClick={() => preview.mutate()}
          >
            <EyeIcon aria-hidden />
            发给自己预览
          </Button>
          <AlertDialog>
            <AlertDialogTrigger
              render={<Button disabled={!ready || busy || !count.data} loading={start.isPending} />}
            >
              <SendIcon aria-hidden />
              开始群发
            </AlertDialogTrigger>
            <AlertDialogPopup>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  发给{audienceLabel(audience)} {count.data?.toLocaleString("zh-CN")} 人？
                </AlertDialogTitle>
                <AlertDialogDescription>
                  发出后无法撤回。每秒约 30
                  条；关掉这个页面也会由定时任务继续发完。被大量举报会导致机器人被 Telegram
                  限制，只发对用户有用的内容。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogClose render={<Button variant="ghost" />}>取消</AlertDialogClose>
                <AlertDialogClose render={<Button />} onClick={() => start.mutate()}>
                  确认群发
                </AlertDialogClose>
              </AlertDialogFooter>
            </AlertDialogPopup>
          </AlertDialog>
        </div>
      </div>
      {busy && (
        <p className="text-muted-foreground text-xs">有一条群发正在进行，发完后才能开始下一条。</p>
      )}
    </Card>
  );
}

function BroadcastCard({ broadcast }: { broadcast: BroadcastRow }) {
  const queryClient = useQueryClient();
  const change = useMutation({
    mutationFn: (action: "pause" | "resume" | "cancel") =>
      $setBroadcastState({ data: { id: broadcast.id, action } }),
    onError: (error) =>
      toastManager.add({ type: "error", title: "操作失败", description: error.message }),
    onSettled: () => invalidate(queryClient, "users", "audit"),
  });
  const reached = broadcast.sent + broadcast.failed + broadcast.blocked;
  const percent = Math.min(100, Math.round((reached / Math.max(1, broadcast.total)) * 100));
  const status = statusBadges[broadcast.status];
  const live = broadcast.status === "running" || broadcast.status === "paused";

  return (
    <Card className="gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant={status.variant}>{status.label}</Badge>
        <span className="text-muted-foreground">
          {audienceLabel(broadcast.audience)} · {dateTime(broadcast.createdAt)}
        </span>
        {live && (
          <div className="ml-auto flex gap-2">
            {broadcast.status === "running" ? (
              <Button size="sm" variant="outline" onClick={() => change.mutate("pause")}>
                <PauseIcon aria-hidden />
                暂停
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => change.mutate("resume")}>
                <PlayIcon aria-hidden />
                继续
              </Button>
            )}
            <Button size="sm" variant="destructive-outline" onClick={() => change.mutate("cancel")}>
              <SquareIcon aria-hidden />
              取消
            </Button>
          </div>
        )}
      </div>
      <p className="line-clamp-3 whitespace-pre-wrap text-sm">{broadcast.text}</p>
      <div className="flex flex-col gap-1.5">
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500"
            style={{ width: `${percent}%` }}
          />
        </div>
        <div className="flex flex-wrap gap-x-4 text-muted-foreground text-xs tabular-nums">
          <span>
            {reached.toLocaleString("zh-CN")} / {broadcast.total.toLocaleString("zh-CN")}（{percent}
            %）
          </span>
          <span>成功 {broadcast.sent}</span>
          {broadcast.blocked > 0 && <span>已屏蔽 {broadcast.blocked}</span>}
          {broadcast.failed > 0 && (
            <span className="text-destructive-foreground">失败 {broadcast.failed}</span>
          )}
        </div>
      </div>
    </Card>
  );
}
