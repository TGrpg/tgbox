import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BroadcastAudience, BroadcastMediaType, OutgoingMessage } from "@tgbox/shared";
import {
  BoldIcon,
  CodeIcon,
  EyeIcon,
  EyeOffIcon,
  FileIcon,
  ImageIcon,
  ItalicIcon,
  LinkIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  QuoteIcon,
  SendIcon,
  SquareIcon,
  StrikethroughIcon,
  Trash2Icon,
  UnderlineIcon,
  XIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
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
import { Tabs, TabsList, TabsTab } from "@/components/coss/ui/tabs.tsx";
import { Textarea } from "@/components/coss/ui/textarea.tsx";
import { toastManager } from "@/components/coss/ui/toast.tsx";
import { dateTime } from "@/features/promotions/labels.ts";
import { SwitchRow } from "@/features/settings/fields.tsx";
import {
  $advanceBroadcast,
  $createBroadcast,
  $previewBroadcast,
  $setBroadcastState,
  $uploadBroadcastMedia,
  audienceQueryOptions,
  type BroadcastRow,
  broadcastsQueryOptions,
} from "@/functions/users.ts";
import { invalidate } from "@/lib/query-keys.ts";

const audienceItems: { value: BroadcastAudience; label: string }[] = [
  { value: "all", label: "全部用户" },
  { value: "active30", label: "近 30 天活跃" },
  { value: "zh", label: "中文用户" },
  { value: "en", label: "英文用户" },
  { value: "submitters", label: "投过稿的用户" },
  { value: "paying", label: "付费用户" },
];
const audienceLabel = (value: BroadcastAudience) =>
  audienceItems.find((item) => item.value === value)?.label ?? value;

const mediaLabels: Record<BroadcastMediaType, string> = {
  photo: "图片",
  video: "视频",
  animation: "GIF",
  document: "文件",
};

const statusBadges: Record<
  BroadcastRow["status"],
  { label: string; variant: "info" | "warning" | "success" | "secondary" }
> = {
  running: { label: "发送中", variant: "info" },
  paused: { label: "已暂停", variant: "warning" },
  done: { label: "已完成", variant: "success" },
  cancelled: { label: "已取消", variant: "secondary" },
};

/** Telegram's own limits: 4096 characters for a message, 1024 for a caption. */
const TEXT_LIMIT = 4096;
const CAPTION_LIMIT = 1024;
const MAX_BUTTONS = 8;
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** What Telegram should call a picked file; a GIF is an animation, not a still photo. */
function mediaTypeOf(file: File): BroadcastMediaType {
  if (file.type === "image/gif") return "animation";
  if (file.type.startsWith("image/")) return "photo";
  if (file.type.startsWith("video/")) return "video";
  return "document";
}

/**
 * While this page is open, a running broadcast is pushed batch after batch (each call sends up to
 * 40 messages at Telegram's pace). It waits out a schedule or a back-off without calling the
 * server; closing the page hands the broadcast back to the 5-minute cron.
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
        const wait = current.notBefore - Date.now();
        await sleep(Math.min(Math.max(wait, 250), 5 * 60_000));
        if (stopped || Date.now() < current.notBefore) continue;
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

type Media = { type: BroadcastMediaType; fileId: string; name: string; url: string | null };

function Composer({ busy }: { busy: boolean }) {
  const queryClient = useQueryClient();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [format, setFormat] = useState<OutgoingMessage["format"]>("plain");
  const [media, setMedia] = useState<Media | null>(null);
  const [buttons, setButtons] = useState<{ text: string; url: string }[]>([]);
  const [perRow, setPerRow] = useState(1);
  const [silent, setSilent] = useState(false);
  const [protect, setProtect] = useState(false);
  const [noPreview, setNoPreview] = useState(false);
  const [audience, setAudience] = useState<BroadcastAudience>("all");
  const [startAt, setStartAt] = useState("");
  const count = useQuery(audienceQueryOptions(audience));

  const limit = media ? CAPTION_LIMIT : TEXT_LIMIT;
  const filledButtons = buttons.filter((button) => button.text.trim() || button.url.trim());
  const buttonsOk = filledButtons.every(
    (button) => button.text.trim() && /^https:\/\/\S+$/.test(button.url.trim()),
  );
  const scheduled = startAt ? new Date(startAt).getTime() : null;
  const scheduleOk = scheduled === null || (!Number.isNaN(scheduled) && scheduled > Date.now());
  const message: OutgoingMessage = {
    text: text.trim(),
    format,
    media: media && { type: media.type, fileId: media.fileId },
    buttons: filledButtons.map((button) => ({ text: button.text.trim(), url: button.url.trim() })),
    buttonsPerRow: perRow,
    silent,
    protect,
    noPreview,
  };
  const ready =
    (message.text !== "" || media !== null) && text.length <= limit && buttonsOk && scheduleOk;

  const reset = () => {
    setText("");
    setMedia(null);
    setButtons([]);
    setStartAt("");
  };

  /** Wraps the selection in an HTML tag (Telegram's formatting subset). */
  const wrap = (open: string, close: string) => {
    const field = textarea.current;
    if (!field) return;
    const { selectionStart: start, selectionEnd: end } = field;
    const next = `${text.slice(0, start)}${open}${text.slice(start, end)}${close}${text.slice(end)}`;
    setText(next);
    setFormat("html");
    requestAnimationFrame(() => {
      field.focus();
      field.setSelectionRange(start + open.length, end + open.length);
    });
  };

  const previewError = (error: string, description?: string) =>
    toastManager.add({
      type: "error",
      title:
        error === "no_admin_id"
          ? "没有可预览的管理员 Telegram ID（ADMIN_IDS）"
          : error === "blocked"
            ? "你屏蔽了机器人，先在 Telegram 里解除"
            : error === "invalid"
              ? "内容不符合要求"
              : "预览发送失败",
      description,
    });

  // Picking a file uploads it once, as a preview to yourself; the broadcast re-sends its file id.
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      const type = mediaTypeOf(file);
      form.append("file", file);
      form.append("type", type);
      form.append("message", JSON.stringify({ ...message, media: null }));
      const result = await $uploadBroadcastMedia({ data: form });
      return { result, file, type };
    },
    onSuccess: ({ result, file }) => {
      if (!result.ok) return previewError(result.error);
      setMedia({
        ...result.media,
        name: file.name,
        url: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
      });
      toastManager.add({ type: "success", title: "已上传，并发到你的 Telegram 预览" });
    },
    onError: (error) =>
      toastManager.add({ type: "error", title: "上传失败", description: error.message }),
  });

  const preview = useMutation({
    mutationFn: () => $previewBroadcast({ data: { message } }),
    onSuccess: (result) =>
      result.ok
        ? toastManager.add({ type: "success", title: "已发到你的 Telegram，先看看效果" })
        : previewError(result.error, "description" in result ? result.description : undefined),
    onError: (error) =>
      toastManager.add({ type: "error", title: "预览发送失败", description: error.message }),
  });

  const start = useMutation({
    mutationFn: () => $createBroadcast({ data: { message, audience, startAt: scheduled } }),
    onSuccess: (result) => {
      if (result.ok) {
        reset();
        toastManager.add({
          type: "success",
          title: scheduled
            ? `已安排在 ${dateTime(scheduled)} 群发，共 ${result.broadcast.total} 人`
            : `开始群发，共 ${result.broadcast.total} 人`,
        });
      } else {
        toastManager.add({
          type: "error",
          title: result.error === "empty" ? "这个范围里没有可发送的用户" : "内容不符合要求",
        });
      }
    },
    onError: (error) =>
      toastManager.add({ type: "error", title: "群发失败", description: error.message }),
    onSettled: () => invalidate(queryClient, "users", "audit"),
  });

  return (
    <Card className="grid gap-6 p-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex min-w-0 flex-col gap-5">
        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label htmlFor="broadcast-text">{media ? "说明文字" : "消息内容"}</Label>
            <Tabs
              value={format}
              onValueChange={(value) => (value === "plain" || value === "html") && setFormat(value)}
            >
              <TabsList>
                <TabsTab value="plain">纯文本</TabsTab>
                <TabsTab value="html">带格式</TabsTab>
              </TabsList>
            </Tabs>
          </div>
          {format === "html" && (
            <div className="flex flex-wrap gap-1">
              {(
                [
                  [BoldIcon, "粗体", "<b>", "</b>"],
                  [ItalicIcon, "斜体", "<i>", "</i>"],
                  [UnderlineIcon, "下划线", "<u>", "</u>"],
                  [StrikethroughIcon, "删除线", "<s>", "</s>"],
                  [EyeOffIcon, "剧透", "<tg-spoiler>", "</tg-spoiler>"],
                  [CodeIcon, "代码", "<code>", "</code>"],
                  [QuoteIcon, "引用", "<blockquote>", "</blockquote>"],
                  [LinkIcon, "链接", '<a href="https://">', "</a>"],
                ] as const
              ).map(([Icon, label, open, close]) => (
                <Button
                  key={label}
                  size="icon-sm"
                  variant="outline"
                  aria-label={label}
                  title={label}
                  onClick={() => wrap(open, close)}
                >
                  <Icon aria-hidden />
                </Button>
              ))}
            </div>
          )}
          <Textarea
            ref={textarea}
            id="broadcast-text"
            placeholder={
              format === "html"
                ? "选中文字后点上面的按钮加格式，例如 <b>粗体</b>。预览一次就知道有没有写错。"
                : "纯文本，链接会自动识别。"
            }
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="min-h-36 font-mono"
          />
          <span
            className={
              text.length > limit
                ? "self-end text-destructive-foreground text-xs"
                : "self-end text-muted-foreground text-xs tabular-nums"
            }
          >
            {text.length} / {limit}
            {media && "（带附件时 Telegram 只允许 1024 字）"}
          </span>
        </section>

        <section className="flex flex-col gap-2">
          <Label>附件</Label>
          {media ? (
            <div className="flex items-center gap-3 rounded-xl border p-2">
              {media.url ? (
                <img src={media.url} alt="" className="size-12 rounded-lg object-cover" />
              ) : (
                <span className="grid size-12 place-items-center rounded-lg bg-muted">
                  <FileIcon className="size-5 text-muted-foreground" aria-hidden />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{media.name}</span>
                <Badge variant="secondary">{mediaLabels[media.type]}</Badge>
              </span>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="移除附件"
                onClick={() => setMedia(null)}
              >
                <XIcon aria-hidden />
              </Button>
            </div>
          ) : (
            <label className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed text-muted-foreground text-sm transition-colors hover:bg-accent/40">
              <ImageIcon className="size-4" aria-hidden />
              {upload.isPending ? "上传中…" : "添加图片 / 视频 / GIF / 文件（20 MB 以内）"}
              <input
                type="file"
                className="sr-only"
                disabled={upload.isPending}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  if (file.size > MAX_UPLOAD_BYTES) {
                    toastManager.add({ type: "error", title: "文件超过 20 MB" });
                    return;
                  }
                  upload.mutate(file);
                }}
              />
            </label>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <Label>链接按钮</Label>
            {buttons.length > 1 && (
              <Select
                items={[1, 2, 3].map((n) => ({ value: n, label: `每行 ${n} 个` }))}
                value={perRow}
                onValueChange={(value) => value && setPerRow(value)}
              >
                <SelectTrigger aria-label="每行按钮数" className="w-28" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  {[1, 2, 3].map((n) => (
                    <SelectItem key={n} value={n}>
                      每行 {n} 个
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            )}
          </div>
          {buttons.map((button, index) => (
            <div key={index} className="grid grid-cols-[9rem_1fr_auto] gap-2">
              <Input
                aria-label={`按钮 ${index + 1} 文字`}
                placeholder="按钮文字"
                maxLength={40}
                value={button.text}
                onChange={(event) =>
                  setButtons((all) =>
                    all.map((item, i) =>
                      i === index ? { ...item, text: event.target.value } : item,
                    ),
                  )
                }
              />
              <Input
                aria-label={`按钮 ${index + 1} 链接`}
                placeholder="https://"
                value={button.url}
                aria-invalid={
                  (button.url.trim() !== "" && !/^https:\/\/\S+$/.test(button.url.trim())) ||
                  undefined
                }
                onChange={(event) =>
                  setButtons((all) =>
                    all.map((item, i) =>
                      i === index ? { ...item, url: event.target.value } : item,
                    ),
                  )
                }
              />
              <Button
                size="icon"
                variant="ghost"
                aria-label={`删除按钮 ${index + 1}`}
                onClick={() => setButtons((all) => all.filter((_, i) => i !== index))}
              >
                <Trash2Icon aria-hidden />
              </Button>
            </div>
          ))}
          {buttons.length < MAX_BUTTONS && (
            <Button
              size="sm"
              variant="outline"
              className="self-start"
              onClick={() => setButtons((all) => [...all, { text: "", url: "" }])}
            >
              <PlusIcon aria-hidden />
              添加按钮
            </Button>
          )}
        </section>

        <section className="grid gap-2 sm:grid-cols-3">
          <SwitchRow label="静默发送" hint="不响提示音" checked={silent} onChange={setSilent} />
          <SwitchRow
            label="禁止转发保存"
            hint="不能转发和保存"
            checked={protect}
            onChange={setProtect}
          />
          <SwitchRow
            label="关闭链接预览"
            hint={media ? "带附件时无效" : "不展开网页卡片"}
            checked={noPreview}
            onChange={setNoPreview}
          />
        </section>

        <section className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-2">
            <Label>发送范围</Label>
            <div className="flex items-center gap-2">
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
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="broadcast-start">定时发送（可选）</Label>
            <Input
              id="broadcast-start"
              type="datetime-local"
              className="w-56"
              value={startAt}
              aria-invalid={!scheduleOk || undefined}
              onChange={(event) => setStartAt(event.target.value)}
            />
          </div>
        </section>

        <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
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
              {scheduled ? "定时群发" : "开始群发"}
            </AlertDialogTrigger>
            <AlertDialogPopup>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {scheduled ? `${dateTime(scheduled)} ` : ""}发给{audienceLabel(audience)}{" "}
                  {count.data?.toLocaleString("zh-CN")} 人？
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
        {busy && (
          <p className="text-muted-foreground text-xs">
            有一条群发正在进行，发完后才能开始下一条。
          </p>
        )}
      </div>

      <MessagePreview message={message} media={media} />
    </Card>
  );
}

/**
 * A rough Telegram bubble so the layout (attachment, text, button rows) can be judged before the
 * real preview. HTML is shown as typed; the preview to yourself is the exact rendering.
 */
function MessagePreview({ message, media }: { message: OutgoingMessage; media: Media | null }) {
  const rows: OutgoingMessage["buttons"][] = [];
  for (let i = 0; i < message.buttons.length; i += message.buttonsPerRow) {
    rows.push(message.buttons.slice(i, i + message.buttonsPerRow));
  }
  const empty = !message.text && !media;
  return (
    <aside className="flex flex-col gap-2 self-start rounded-2xl bg-[#e7ebf0] p-3 lg:sticky lg:top-20 dark:bg-[#0e1621]">
      <span className="text-muted-foreground text-xs">预览（近似效果）</span>
      <div className="flex flex-col gap-1">
        <div className="overflow-hidden rounded-2xl rounded-bl-md bg-white shadow-sm dark:bg-[#182533]">
          {media &&
            (media.url ? (
              <img src={media.url} alt="" className="max-h-56 w-full object-cover" />
            ) : (
              <div className="flex items-center gap-2 border-b p-3 text-sm">
                <FileIcon className="size-5 text-sky-500" aria-hidden />
                <span className="truncate">{media.name}</span>
              </div>
            ))}
          <p className="whitespace-pre-wrap break-words px-3 py-2 text-sm" dir="auto">
            {empty ? (
              <span className="text-muted-foreground">消息内容会显示在这里</span>
            ) : (
              message.text
            )}
          </p>
        </div>
        {rows.map((row, index) => (
          <div key={index} className="flex gap-1">
            {row.map((button, column) => (
              <PreviewButton key={column}>{button.text}</PreviewButton>
            ))}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-1">
        {message.silent && <Badge variant="outline">静默</Badge>}
        {message.protect && <Badge variant="outline">禁止转发</Badge>}
        {message.noPreview && !media && <Badge variant="outline">无链接预览</Badge>}
      </div>
    </aside>
  );
}

function PreviewButton({ children }: { children: ReactNode }) {
  return (
    <span className="flex-1 truncate rounded-lg bg-black/25 px-2 py-1.5 text-center font-medium text-white text-xs dark:bg-white/15">
      {children}
    </span>
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
  const waiting =
    broadcast.status === "running" && reached === 0 && broadcast.notBefore > Date.now();
  const status = waiting
    ? { label: `定时 ${dateTime(broadcast.notBefore)}`, variant: "warning" as const }
    : statusBadges[broadcast.status];
  const live = broadcast.status === "running" || broadcast.status === "paused";

  return (
    <Card className="gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant={status.variant}>{status.label}</Badge>
        {broadcast.media && <Badge variant="secondary">{mediaLabels[broadcast.media.type]}</Badge>}
        {broadcast.buttons.length > 0 && (
          <Badge variant="secondary">{broadcast.buttons.length} 个按钮</Badge>
        )}
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
