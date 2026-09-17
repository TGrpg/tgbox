import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HammerIcon } from "lucide-react";
import { Badge } from "@/components/coss/ui/badge.tsx";
import { Button } from "@/components/coss/ui/button.tsx";
import { Card } from "@/components/coss/ui/card.tsx";
import { Skeleton } from "@/components/coss/ui/skeleton.tsx";
import { toastManager } from "@/components/coss/ui/toast.tsx";
import { $triggerBuild, buildStatusQueryOptions } from "@/functions/audit.ts";
import { invalidate } from "@/lib/query-keys.ts";

const dateTime = (ms: number) =>
  new Date(ms).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" });

export function BuildPanel() {
  const queryClient = useQueryClient();
  const status = useQuery(buildStatusQueryOptions());
  const build = useMutation({
    mutationFn: () => $triggerBuild(),
    onSuccess: ({ dispatched }) =>
      toastManager.add(
        dispatched
          ? {
              type: "success",
              title: "已触发站点构建",
              description: "GitHub Actions 完成后站点自动更新",
            }
          : {
              type: "warning",
              title: "已标记待构建",
              description: "构建派发失败或未配置 GITHUB_REPO",
            },
      ),
    onError: (error) =>
      toastManager.add({ type: "error", title: "触发失败", description: error.message }),
    onSettled: () =>
      invalidate(queryClient, "buildStatus", "adminStats", "audit", "dashboardActivity"),
  });

  if (status.isPending) return <Skeleton className="h-20 rounded-2xl" />;
  if (status.isError) {
    return (
      <p className="text-destructive-foreground text-sm">
        构建状态加载失败：{status.error.message}
      </p>
    );
  }
  const data = status.data;
  return (
    <Card className="flex-row flex-wrap items-center gap-x-8 gap-y-3 p-4 text-sm">
      <Item label="站点状态">
        {data.dirtySince === null ? (
          <Badge variant="success">已是最新</Badge>
        ) : (
          <Badge variant="warning">待构建 · {dateTime(data.dirtySince)} 起</Badge>
        )}
      </Item>
      <Item label="上次构建">
        {data.lastBuildAt === null ? "暂无记录" : dateTime(data.lastBuildAt)}
      </Item>
      <Item label="上次手动触发">
        {data.lastTrigger === null ? (
          "暂无记录"
        ) : (
          <span>
            {dateTime(data.lastTrigger.at)}{" "}
            <span className="text-muted-foreground">({data.lastTrigger.actor})</span>
          </span>
        )}
      </Item>
      <Button
        className="w-full sm:ml-auto sm:w-auto"
        loading={build.isPending}
        onClick={() => build.mutate()}
      >
        <HammerIcon aria-hidden />
        立即构建
      </Button>
      {!data.dispatchConfigured && (
        <p className="w-full text-muted-foreground text-xs">
          未配置 GITHUB_REPO：只会标记待构建，不会派发 GitHub Actions。
        </p>
      )}
    </Card>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
