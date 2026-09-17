import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { TaxonomyError } from "@tgbox/core";
import type { EntryKind } from "@tgbox/shared";
import { toastManager } from "@/components/coss/ui/toast.tsx";
import {
  $deleteCategory,
  $deleteTag,
  $reorderCategories,
  $upsertCategory,
  $upsertTag,
  type Taxonomy,
  taxonomyQueryOptions,
} from "@/functions/taxonomy.ts";
import { invalidate } from "@/lib/query-keys.ts";
import { taxonomyErrorLabels } from "./labels.ts";

type Outcome = { ok: true } | { ok: false; error: TaxonomyError };

/** Taxonomy mutations. Every change marks the site dirty and may rename things other pages show. */
export function useTaxonomyMutations() {
  const queryClient = useQueryClient();
  const { queryKey } = taxonomyQueryOptions();

  const settle = () =>
    invalidate(
      queryClient,
      "taxonomy",
      "entries",
      "adminStats",
      "buildStatus",
      "dashboardActivity",
      "audit",
    );

  const report = (success: string) => (result: Outcome) => {
    if (result.ok) toastManager.add({ type: "success", title: success });
    else toastManager.add({ type: "error", title: taxonomyErrorLabels[result.error] });
  };
  const fail = (error: Error) =>
    toastManager.add({ type: "error", title: "操作失败", description: error.message });

  const upsertCategory = useMutation({
    mutationFn: (data: Parameters<typeof $upsertCategory>[0]["data"]) => $upsertCategory({ data }),
    onSuccess: report("分类已保存"),
    onError: fail,
    onSettled: settle,
  });

  const deleteCategory = useMutation({
    mutationFn: (id: number) => $deleteCategory({ data: { id } }),
    onSuccess: report("分类已删除"),
    onError: fail,
    onSettled: settle,
  });

  const reorderCategories = useMutation({
    mutationFn: (data: { kind: EntryKind; ids: number[] }) => $reorderCategories({ data }),
    // The dragged order is already on screen; write matching sort values so a refetch doesn't jump.
    onMutate: async ({ kind, ids }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData(queryKey);
      queryClient.setQueryData(queryKey, (old: Taxonomy | undefined) =>
        old
          ? {
              ...old,
              categories: old.categories
                .map((category) => {
                  const index = category.kind === kind ? ids.indexOf(category.id) : -1;
                  return index < 0 ? category : { ...category, sort: (index + 1) * 10 };
                })
                .sort((a, b) => a.kind.localeCompare(b.kind) || a.sort - b.sort || a.id - b.id),
            }
          : old,
      );
      return { previous };
    },
    onSuccess: (result) => {
      if (result.changed > 0) toastManager.add({ type: "success", title: "排序已更新" });
    },
    onError: (error, _input, context) => {
      if (context) queryClient.setQueryData(queryKey, context.previous);
      fail(error);
    },
    onSettled: settle,
  });

  const upsertTag = useMutation({
    mutationFn: (data: Parameters<typeof $upsertTag>[0]["data"]) => $upsertTag({ data }),
    onSuccess: report("标签已保存"),
    onError: fail,
    onSettled: settle,
  });

  const deleteTag = useMutation({
    mutationFn: (id: number) => $deleteTag({ data: { id } }),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData(queryKey);
      queryClient.setQueryData(queryKey, (old: Taxonomy | undefined) =>
        old ? { ...old, tags: old.tags.filter((tag) => tag.id !== id) } : old,
      );
      return { previous };
    },
    onSuccess: report("标签已删除"),
    onError: (error, _id, context) => {
      if (context) queryClient.setQueryData(queryKey, context.previous);
      fail(error);
    },
    onSettled: settle,
  });

  return { upsertCategory, deleteCategory, reorderCategories, upsertTag, deleteTag };
}
