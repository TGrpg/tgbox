import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FriendLink, MAX_FEATURED } from "@tgbox/shared";
import { Skeleton } from "@/components/coss/ui/skeleton.tsx";
import { toastManager } from "@/components/coss/ui/toast.tsx";
import { LinkListEditor } from "@/components/link-list-editor.tsx";
import { $saveFeatured, featuredQueryOptions } from "@/functions/featured.ts";
import { invalidate } from "@/lib/query-keys.ts";

export function FeaturedTab() {
  const queryClient = useQueryClient();
  const saved = useQuery(featuredQueryOptions());
  const save = useMutation({
    mutationFn: (featured: FriendLink[]) => $saveFeatured({ data: { featured } }),
    onSuccess: ({ changed }) =>
      toastManager.add({
        type: "success",
        title: changed ? "已保存，GitHub README 每日刷新" : "没有变化",
      }),
    onError: (error) =>
      toastManager.add({ type: "error", title: "保存失败", description: error.message }),
    onSettled: () => invalidate(queryClient, "featured", "settings", "audit", "dashboardActivity"),
  });

  if (saved.isPending) return <Skeleton className="h-64 rounded-2xl" />;
  if (saved.isError) {
    return <p className="text-destructive-foreground text-sm">加载失败：{saved.error.message}</p>;
  }
  return (
    <LinkListEditor
      key={JSON.stringify(saved.data)}
      initial={saved.data}
      title="Awesome 推荐"
      hint="按顺序显示在 GitHub awesome-telegram README 顶部，每日刷新。简介可留空。"
      emptyText="还没有推荐。"
      maxLinks={MAX_FEATURED}
      saving={save.isPending}
      onSave={(featured) => save.mutate(featured)}
    />
  );
}
