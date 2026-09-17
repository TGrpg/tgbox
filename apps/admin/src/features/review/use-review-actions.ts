import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { RejectReason } from "@tgbox/core";
import { toastManager } from "@/components/coss/ui/toast.tsx";
import {
  $approveSubmissions,
  $rejectSubmissions,
  reviewQueueQueryOptions,
} from "@/functions/review.ts";
import { invalidate } from "@/lib/query-keys.ts";
import { rejectReasonLabels } from "./labels.ts";

/**
 * Approve / reject mutations for pending submissions. Rows leave the pending page optimistically
 * and come back if the request fails; afterwards every view that counts submissions is refetched.
 */
export function useReviewActions(page: number) {
  const queryClient = useQueryClient();
  const { queryKey } = reviewQueueQueryOptions("pending", page);

  const removeOptimistically = async (ids: number[]) => {
    await queryClient.cancelQueries({ queryKey });
    const previous = queryClient.getQueryData(queryKey);
    queryClient.setQueryData(queryKey, (old) =>
      old
        ? {
            rows: old.rows.filter((row) => !ids.includes(row.id)),
            total: Math.max(0, old.total - ids.length),
          }
        : old,
    );
    return { previous };
  };

  const settle = () =>
    invalidate(queryClient, "reviewQueue", "adminStats", "dashboardActivity", "audit", "entries");

  const fail = (
    error: Error,
    context: Awaited<ReturnType<typeof removeOptimistically>> | undefined,
  ) => {
    if (context) queryClient.setQueryData(queryKey, context.previous);
    toastManager.add({ type: "error", title: "操作失败", description: error.message });
  };

  const approve = useMutation({
    mutationFn: (ids: number[]) => $approveSubmissions({ data: { ids } }),
    onMutate: removeOptimistically,
    onError: (error, _ids, context) => fail(error, context),
    onSuccess: (results) => {
      const done = results.filter((result) => result.ok).length;
      toastManager.add({
        type: "success",
        title: `已通过 ${done} 条`,
        description:
          done < results.length ? `${results.length - done} 条已被其他管理员处理` : "条目已收录",
      });
    },
    onSettled: settle,
  });

  const reject = useMutation({
    mutationFn: (input: { ids: number[]; reason: RejectReason }) =>
      $rejectSubmissions({ data: input }),
    onMutate: (input) => removeOptimistically(input.ids),
    onError: (error, _input, context) => fail(error, context),
    onSuccess: (results, input) => {
      const done = results.filter((result) => result.ok).length;
      toastManager.add({
        type: "success",
        title: `已拒绝 ${done} 条`,
        description: `原因：${rejectReasonLabels[input.reason]}`,
      });
    },
    onSettled: settle,
  });

  return { approve, reject };
}
