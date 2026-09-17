import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRightIcon, HammerIcon } from "lucide-react";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { Badge } from "@/components/coss/ui/badge.tsx";
import { Button } from "@/components/coss/ui/button.tsx";
import { Card } from "@/components/coss/ui/card.tsx";
import { Skeleton } from "@/components/coss/ui/skeleton.tsx";
import { toastManager } from "@/components/coss/ui/toast.tsx";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/coss/ui/tooltip.tsx";
import { dateTime, kindLabels, livenessLabels } from "@/features/review/labels.ts";
import { $triggerBuild, dashboardActivityQueryOptions } from "@/functions/dashboard.ts";
import { invalidate } from "@/lib/query-keys.ts";

const auditLabels: Record<string, string> = {
  "submission.approve": "通过提交",
  "submission.reject": "拒绝提交",
  "entry.list": "手动收录",
  "entry.status": "修改状态",
  "entry.category": "修改分类",
  "entry.tags": "修改标签",
  "entry.promote": "推荐设置",
  "entry.refresh": "立即刷新",
  "build.trigger": "触发构建",
  "blacklist.add": "加入黑名单",
  "blacklist.remove": "移出黑名单",
};

const submissionStatus = {
  pending: { label: "待审核", variant: "warning" },
  approved: { label: "已通过", variant: "success" },
  rejected: { label: "已拒绝", variant: "error" },
} as const;

export function BuildButton() {
  const queryClient = useQueryClient();
  const activity = useQuery(dashboardActivityQueryOptions());
  const build = useMutation({
    mutationFn: () => $triggerBuild(),
    onSuccess: ({ dispatched }) =>
      toastManager.add(
        dispatched
          ? { type: "success", title: "已触发构建", description: "GitHub Actions 将重新生成站点" }
          : {
              type: "warning",
              title: "构建请求未成功",
              description: "站点已标记为待构建，请查看日志",
            },
      ),
    onError: (error) =>
      toastManager.add({ type: "error", title: "触发失败", description: error.message }),
    onSettled: () => invalidate(queryClient, "adminStats", "dashboardActivity", "audit"),
  });

  if (activity.data?.buildEnabled === false) {
    // A disabled button gets no pointer events, so this one is only aria-disabled and carries the
    // tooltip (tap opens it in the Mini App).
    return (
      <Tooltip>
        <TooltipTrigger render={<Button aria-disabled className="cursor-not-allowed opacity-64" />}>
          <HammerIcon aria-hidden />
          立即构建
        </TooltipTrigger>
        <TooltipPopup>未配置 GITHUB_REPO，无法触发构建</TooltipPopup>
      </Tooltip>
    );
  }
  return (
    <Button onClick={() => build.mutate()} loading={build.isPending} disabled={activity.isPending}>
      <HammerIcon aria-hidden />
      立即构建
    </Button>
  );
}

export function LastTrigger() {
  const activity = useQuery(dashboardActivityQueryOptions());
  const at = activity.data?.lastBuildTriggerAt;
  return <span>{at === undefined ? "…" : at === null ? "暂无记录" : dateTime(at)}</span>;
}

export function DashboardActivity() {
  const activity = useQuery(dashboardActivityQueryOptions());

  if (activity.isPending) {
    return (
      <div className="grid gap-3 md:grid-cols-3 md:gap-4">
        {["a", "b", "c"].map((key) => (
          <Skeleton key={key} className="h-64 rounded-2xl" />
        ))}
      </div>
    );
  }
  if (activity.isError) {
    return (
      <p className="text-destructive-foreground text-sm">动态加载失败：{activity.error.message}</p>
    );
  }
  const { submissions, systemHides, audit } = activity.data;

  return (
    <div className="grid gap-3 md:grid-cols-3 md:gap-4">
      <Panel title="最近提交" link={{ to: "/review", label: "审核队列" }} index={0}>
        {submissions.length === 0 ? (
          <EmptyLine>暂无提交</EmptyLine>
        ) : (
          submissions.map((row) => (
            <Line
              key={row.id}
              primary={row.fetchedTitle ?? row.username}
              secondary={`@${row.username} · ${kindLabels[row.kind]} · ${dateTime(row.createdAt)}`}
              aside={
                <Badge variant={submissionStatus[row.status].variant}>
                  {submissionStatus[row.status].label}
                </Badge>
              }
            />
          ))
        )}
      </Panel>
      <Panel title="系统隐藏" link={{ to: "/entries", label: "条目" }} index={1}>
        {systemHides.length === 0 ? (
          <EmptyLine>最近没有被系统隐藏的条目</EmptyLine>
        ) : (
          systemHides.map((row) => (
            <Line
              key={row.id}
              primary={row.title}
              secondary={`@${row.username} · ${dateTime(row.updatedAt)}`}
              aside={<Badge variant="warning">{livenessLabels[row.liveness]}</Badge>}
            />
          ))
        )}
      </Panel>
      <Panel title="操作日志" link={{ to: "/audit", label: "全部" }} index={2}>
        {audit.length === 0 ? (
          <EmptyLine>暂无操作</EmptyLine>
        ) : (
          audit.map((row) => (
            <Line
              key={row.id}
              primary={`${auditLabels[row.action] ?? row.action}${row.username ? ` · @${row.username}` : row.target ? ` · ${row.target}` : ""}`}
              secondary={`${row.actor} · ${dateTime(row.createdAt)}`}
            />
          ))
        )}
      </Panel>
    </div>
  );
}

function Panel({
  title,
  link,
  index,
  children,
}: {
  title: string;
  link: { to: "/review" | "/entries" | "/audit"; label: string };
  index: number;
  children: ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 + index * 0.05, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
    >
      <Card className="h-full gap-0 p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="font-medium text-sm">{title}</h2>
          <Link
            to={link.to}
            className="inline-flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
          >
            {link.label}
            <ArrowRightIcon className="size-3" aria-hidden />
          </Link>
        </div>
        <ul className="flex flex-col divide-y">{children}</ul>
      </Card>
    </motion.div>
  );
}

function Line({
  primary,
  secondary,
  aside,
}: {
  primary: string;
  secondary: string;
  aside?: ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{primary}</div>
        <div className="truncate text-muted-foreground text-xs">{secondary}</div>
      </div>
      {aside}
    </li>
  );
}

function EmptyLine({ children }: { children: ReactNode }) {
  return <li className="px-4 py-6 text-center text-muted-foreground text-sm">{children}</li>;
}
