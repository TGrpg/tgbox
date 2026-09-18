import { useQuery } from "@tanstack/react-query";
import type { RejectReason } from "@tgbox/core";
import type { Submission } from "@tgbox/db";
import { CheckIcon, ExternalLinkIcon, RefreshCwIcon, XIcon } from "lucide-react";
import { motion } from "motion/react";
import { type ReactNode, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/coss/ui/avatar.tsx";
import { Badge } from "@/components/coss/ui/badge.tsx";
import { Button } from "@/components/coss/ui/button.tsx";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/coss/ui/select.tsx";
import {
  Sheet,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "@/components/coss/ui/sheet.tsx";
import { Skeleton } from "@/components/coss/ui/skeleton.tsx";
import { UserChip } from "@/components/user-chip.tsx";
import { submissionPreviewQueryOptions } from "@/functions/review.ts";
import {
  compactNumber,
  dateTime,
  kindLabels,
  livenessLabels,
  rejectReasonLabel,
  rejectReasonOptions,
} from "./labels.ts";

type Names = { category: (id: number) => string; tag: (id: number) => string };

export function SubmissionDrawer({
  submission,
  names,
  rejectOpen,
  onRejectOpenChange,
  onClose,
  onApprove,
  onReject,
}: {
  submission: Submission | undefined;
  names: Names;
  rejectOpen: boolean;
  onRejectOpenChange: (open: boolean) => void;
  onClose: () => void;
  onApprove: (id: number) => void;
  onReject: (id: number, reason: RejectReason) => void;
}) {
  return (
    <Sheet open={submission !== undefined} onOpenChange={(open) => !open && onClose()}>
      <SheetPopup side="right" className="md:max-w-lg">
        {submission && (
          <>
            <SheetHeader>
              <div className="flex items-center gap-3 pe-8">
                <Avatar className="size-11">
                  <AvatarFallback>{initial(submission)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <SheetTitle className="truncate">
                    {submission.fetchedTitle ?? submission.username}
                  </SheetTitle>
                  <SheetDescription>
                    <a
                      href={`https://t.me/${submission.username}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 hover:underline"
                    >
                      @{submission.username}
                      <ExternalLinkIcon className="size-3" aria-hidden />
                    </a>
                  </SheetDescription>
                </div>
              </div>
            </SheetHeader>
            <SheetPanel className="flex flex-col gap-5">
              <SubmissionFacts submission={submission} names={names} />
              <LivePreview key={submission.id} submission={submission} />
            </SheetPanel>
            {submission.status === "pending" && (
              <SheetFooter className="flex-row gap-2">
                <RejectSelect
                  open={rejectOpen}
                  onOpenChange={onRejectOpenChange}
                  onReject={(reason) => onReject(submission.id, reason)}
                  className="flex-1"
                />
                <Button className="flex-1" onClick={() => onApprove(submission.id)}>
                  <CheckIcon aria-hidden />
                  通过
                  <Kbd>A</Kbd>
                </Button>
              </SheetFooter>
            )}
          </>
        )}
      </SheetPopup>
    </Sheet>
  );
}

export function RejectSelect({
  onReject,
  open,
  onOpenChange,
  className,
  label = "拒绝",
  disabled,
}: {
  onReject: (reason: RejectReason) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <Select<RejectReason>
      value={null}
      open={open}
      onOpenChange={onOpenChange}
      disabled={disabled}
      onValueChange={(reason) => reason && onReject(reason)}
      items={rejectReasonOptions}
    >
      <SelectTrigger className={className} aria-label="选择拒绝原因">
        <span className="flex items-center gap-2 text-destructive-foreground">
          <XIcon className="size-4" aria-hidden />
          <SelectValue placeholder={label}>{() => label}</SelectValue>
        </span>
      </SelectTrigger>
      <SelectPopup alignItemWithTrigger={false}>
        {rejectReasonOptions.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

export function Kbd({ children }: { children: string }) {
  return (
    <kbd className="ms-1 hidden rounded border border-current/20 px-1 font-mono text-[10px] leading-4 opacity-70 md:inline">
      {children}
    </kbd>
  );
}

export const initial = (submission: Pick<Submission, "fetchedTitle" | "username">) =>
  [...(submission.fetchedTitle?.trim() || submission.username)][0]?.toUpperCase() ?? "?";

function SubmissionFacts({ submission, names }: { submission: Submission; names: Names }) {
  const facts: [string, ReactNode][] = [
    [
      "类型",
      <Badge key="kind" variant="outline">
        {kindLabels[submission.kind]}
      </Badge>,
    ],
    ["分类", names.category(submission.categoryId)],
    [
      "标签",
      submission.tagIds.length === 0 ? (
        "—"
      ) : (
        <span key="tags" className="flex flex-wrap gap-1">
          {submission.tagIds.map((id) => (
            <Badge key={id} variant="secondary">
              {names.tag(id)}
            </Badge>
          ))}
        </span>
      ),
    ],
    ["成员（提交时）", compactNumber(submission.fetchedMembers)],
    [
      "提交者",
      <a key="user" className="hover:underline" href={`tg://user?id=${submission.tgUserId}`}>
        <UserChip id={submission.tgUserId} showId />
      </a>,
    ],
    ["提交时间", dateTime(submission.createdAt)],
  ];
  if (submission.status !== "pending") {
    facts.push([
      "审核结果",
      submission.status === "approved"
        ? "已通过"
        : `已拒绝 · ${rejectReasonLabel(submission.rejectReason)}`,
    ]);
    if (submission.reviewedAt !== null) facts.push(["审核时间", dateTime(submission.reviewedAt)]);
  }

  return (
    <section className="flex flex-col gap-3">
      <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-2.5 text-sm">
        {facts.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0">{value}</dd>
          </div>
        ))}
      </dl>
      {submission.fetchedDescription && (
        <p className="whitespace-pre-line rounded-lg bg-muted/50 p-3 text-sm">
          {submission.fetchedDescription}
        </p>
      )}
    </section>
  );
}

function LivePreview({ submission }: { submission: Submission }) {
  const [enabled, setEnabled] = useState(false);
  const preview = useQuery({
    ...submissionPreviewQueryOptions(submission.username, submission.kind),
    enabled,
  });

  return (
    <section className="flex flex-col gap-3 border-t pt-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium text-sm">实时预览</h3>
        <Button
          size="sm"
          variant="outline"
          loading={preview.isFetching}
          onClick={() => (enabled ? preview.refetch() : setEnabled(true))}
        >
          <RefreshCwIcon aria-hidden />
          {enabled ? "重新抓取" : "抓取 t.me"}
        </Button>
      </div>
      {!enabled ? (
        <p className="text-muted-foreground text-sm">
          从 t.me 读取当前资料与最近帖子，仅预览，不写入数据库。
        </p>
      ) : preview.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-14 rounded-lg" />
          <Skeleton className="h-24 rounded-lg" />
        </div>
      ) : preview.isError ? (
        <p className="text-destructive-foreground text-sm">抓取失败：{preview.error.message}</p>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col gap-3"
        >
          <div className="flex items-center gap-3">
            <Avatar className="size-12">
              {preview.data.profile?.avatarUrl && (
                <AvatarImage src={preview.data.profile.avatarUrl} alt="" />
              )}
              <AvatarFallback>{initial(submission)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 text-sm">
              <div className="truncate font-medium">
                {preview.data.profile?.title ?? "（无标题）"}
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
                <Badge variant={preview.data.liveness === "active" ? "success" : "warning"}>
                  {livenessLabels[preview.data.liveness]}
                </Badge>
                {preview.data.kind && preview.data.kind !== submission.kind && (
                  <Badge variant="error">
                    实际类型：
                    {preview.data.kind === "user" ? "用户" : kindLabels[preview.data.kind]}
                  </Badge>
                )}
                <span>
                  {compactNumber(
                    preview.data.profile?.members ?? preview.data.profile?.monthlyUsers,
                  )}{" "}
                  {submission.kind === "bot" ? "月活" : "成员"}
                </span>
                {preview.data.lang && <span>· {preview.data.lang}</span>}
              </div>
            </div>
          </div>
          {preview.data.rateLimited && (
            <p className="text-warning-foreground text-sm">t.me 限流，结果可能不完整。</p>
          )}
          {preview.data.profile?.description && (
            <p className="whitespace-pre-line text-sm">{preview.data.profile.description}</p>
          )}
          {preview.data.posts && (
            <div className="flex flex-col gap-2">
              <h4 className="text-muted-foreground text-xs">最近帖子</h4>
              {preview.data.posts.length === 0 ? (
                <p className="text-muted-foreground text-sm">暂无帖子</p>
              ) : (
                preview.data.posts.map((post) => (
                  <article key={post.id} className="rounded-lg border p-3 text-sm">
                    <div className="mb-1 flex justify-between text-muted-foreground text-xs">
                      <time dateTime={post.date}>{dateTime(Date.parse(post.date))}</time>
                      {post.views !== null && <span>{compactNumber(post.views)} 次浏览</span>}
                    </div>
                    <p className="line-clamp-4 whitespace-pre-line">{post.text || "（媒体）"}</p>
                  </article>
                ))
              )}
            </div>
          )}
        </motion.div>
      )}
    </section>
  );
}
