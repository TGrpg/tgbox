import { type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ModerationError } from "@tgbox/core";
import type { EntryStatus } from "@tgbox/shared";
import { toastManager } from "@/components/coss/ui/toast.tsx";
import {
  $editEntry,
  type $listEntries,
  $refreshEntry,
  $setEntriesCategory,
  $setEntriesPromoted,
  $setEntriesStatus,
  type EntryRow,
} from "@/functions/entries.ts";
import {
  $setEntryPostsVisibility,
  $setPostVisibility,
  type EntryPostsView,
} from "@/functions/posts.ts";
import { invalidate, queryKeys } from "@/lib/query-keys.ts";
import { entryEditErrorText } from "./edit.ts";
import { formatCount, livenessLabel, statusLabel } from "./labels.ts";

type Page = Awaited<ReturnType<typeof $listEntries>>;

/** Optimistically patches cached list pages; returns a rollback. */
function patchRows(client: QueryClient, ids: number[], patch: Partial<EntryRow>) {
  const snapshot = client.getQueriesData<Page>({ queryKey: queryKeys.entries });
  client.setQueriesData<Page>({ queryKey: queryKeys.entries }, (page) =>
    page
      ? {
          ...page,
          rows: page.rows.map((row) => (ids.includes(row.id) ? { ...row, ...patch } : row)),
        }
      : page,
  );
  return () => {
    for (const [key, data] of snapshot) client.setQueryData(key, data);
  };
}

type LoadedPosts = Extract<EntryPostsView, { ok: true }>;

/** Patches the cached posts panel of one entry in place, so toggling costs no extra R2 read. */
function patchPosts(
  client: QueryClient,
  username: string,
  patch: (view: LoadedPosts) => LoadedPosts,
) {
  const key = [...queryKeys.entryPosts, username];
  const before = client.getQueryData<EntryPostsView>(key);
  client.setQueryData<EntryPostsView>(key, (view) => (view?.ok ? patch(view) : view));
  return () => client.setQueryData<EntryPostsView>(key, before);
}

function useSettled() {
  const client = useQueryClient();
  return () => invalidate(client, "entries", "adminStats", "dashboardActivity", "audit");
}

const failed = (error: Error) =>
  toastManager.add({ type: "error", title: "操作失败", description: error.message });

export function useSetStatus() {
  const client = useQueryClient();
  const settled = useSettled();
  return useMutation({
    mutationFn: (input: { ids: number[]; status: EntryStatus }) =>
      $setEntriesStatus({ data: input }),
    onMutate: async (input) => {
      await client.cancelQueries({ queryKey: queryKeys.entries });
      return { rollback: patchRows(client, input.ids, { status: input.status }) };
    },
    onError: (error, _input, context) => {
      context?.rollback();
      failed(error);
    },
    onSuccess: (result, input) =>
      toastManager.add({
        type: "success",
        title: `已设为「${statusLabel[input.status]}」`,
        description: `${result.changed.length} 条发生变化`,
      }),
    onSettled: settled,
  });
}

export function useSetPromoted() {
  const client = useQueryClient();
  const settled = useSettled();
  return useMutation({
    mutationFn: (input: { ids: number[]; promoted: boolean }) =>
      $setEntriesPromoted({ data: input }),
    onMutate: async (input) => {
      await client.cancelQueries({ queryKey: queryKeys.entries });
      return { rollback: patchRows(client, input.ids, { promoted: input.promoted }) };
    },
    onError: (error, _input, context) => {
      context?.rollback();
      failed(error);
    },
    onSuccess: (result, input) =>
      toastManager.add({
        type: "success",
        title: input.promoted ? "已设为推广" : "已取消推广",
        description: `${result.changed.length} 条发生变化`,
      }),
    onSettled: settled,
  });
}

export function useSetCategory() {
  const settled = useSettled();
  return useMutation({
    mutationFn: (input: { ids: number[]; categoryId: number }) =>
      $setEntriesCategory({ data: input }),
    onError: failed,
    onSuccess: (result) =>
      toastManager.add({
        type: result.skipped.length > 0 ? "warning" : "success",
        title: "分类已更新",
        description:
          `${result.changed.length} 条发生变化` +
          (result.skipped.length > 0 ? `，${result.skipped.length} 条类型不匹配已跳过` : ""),
      }),
    onSettled: settled,
  });
}

export function useEditEntry(onDone: () => void) {
  const settled = useSettled();
  return useMutation({
    mutationFn: (input: { id: number; categoryId: number; tagIds: number[]; promoted: boolean }) =>
      $editEntry({ data: input }),
    onError: failed,
    onSuccess: (result) => {
      if (!result.ok) {
        toastManager.add({
          type: "error",
          title: "保存失败",
          description:
            result.error === "not_found" ? "条目不存在" : entryEditErrorText[result.error],
        });
        return;
      }
      const changed = result.categoryChanged || result.tagsChanged || result.promotedChanged;
      toastManager.add({ type: "success", title: changed ? "已保存" : "没有变化" });
      onDone();
    },
    onSettled: settled,
  });
}

const fieldLabel: Record<string, string> = {
  title: "标题",
  description: "简介",
  lang: "语言",
  verified: "认证",
  liveness: "存活",
  status: "状态",
  members: "成员",
  online: "在线",
  activityTier: "活跃度",
};

const show = (field: string, value: string | number | boolean | null) => {
  if (value === null) return "—";
  if (field === "members" || field === "online")
    return typeof value === "number" ? formatCount(value) : String(value);
  const liveness = Object.entries(livenessLabel).find(([key]) => key === value);
  if (field === "liveness" && liveness) return liveness[1];
  if (typeof value === "string" && value.length > 24) return `${value.slice(0, 24)}…`;
  return String(value);
};

export function useRefreshEntry() {
  const settled = useSettled();
  return useMutation({
    mutationFn: (id: number) => $refreshEntry({ data: { id } }),
    onError: failed,
    onSuccess: (result) => {
      if (!result) {
        toastManager.add({ type: "error", title: "条目不存在" });
        return;
      }
      toastManager.add({
        type: result.liveness === "active" ? "success" : "warning",
        title: `刷新完成 · ${livenessLabel[result.liveness]}`,
        description:
          result.changes.length === 0
            ? "没有字段变化"
            : result.changes
                .map(
                  (c) =>
                    `${fieldLabel[c.field] ?? c.field}：${show(c.field, c.before)} → ${show(c.field, c.after)}`,
                )
                .join("\n"),
      });
    },
    onSettled: settled,
  });
}

/* ------------------------------------------------------- post moderation */

const moderationErrorText: Record<ModerationError, string> = {
  invalid_username: "用户名无效",
  not_found: "条目不存在",
};

const appliesAtNextBuild = "下次网站构建后生效";

/** Hides or shows every post preview of one entry. */
export function useSetEntryPostsVisibility() {
  const client = useQueryClient();
  const settled = useSettled();
  return useMutation({
    mutationFn: (input: { id: number; username: string; hide: boolean }) =>
      $setEntryPostsVisibility({ data: { username: input.username, hide: input.hide } }),
    onMutate: async (input) => {
      await client.cancelQueries({ queryKey: queryKeys.entries });
      const rollbackPosts = patchPosts(client, input.username, (view) => ({
        ...view,
        hidePosts: input.hide,
      }));
      const rollbackRows = patchRows(client, [input.id], { hidePosts: input.hide });
      return {
        rollback: () => {
          rollbackPosts();
          rollbackRows();
        },
      };
    },
    onError: (error, _input, context) => {
      context?.rollback();
      failed(error);
    },
    onSuccess: (result, input) => {
      if (!result.ok) {
        toastManager.add({
          type: "error",
          title: "操作失败",
          description: moderationErrorText[result.error],
        });
        return;
      }
      toastManager.add({
        type: "success",
        title: input.hide ? "已隐藏最近消息" : "已恢复最近消息",
        description: appliesAtNextBuild,
      });
    },
    onSettled: settled,
  });
}

/** Hides or shows one post. The panel's cache is patched in place: no extra R2 read. */
export function useSetPostVisibility(username: string) {
  const client = useQueryClient();
  const settled = useSettled();
  return useMutation({
    mutationFn: (input: { postId: number; hidden: boolean }) =>
      $setPostVisibility({ data: { username, ...input } }),
    onMutate: (input) => ({
      rollback: patchPosts(client, username, (view) => ({
        ...view,
        posts: view.posts.map((post) =>
          post.id === input.postId ? { ...post, hidden: input.hidden } : post,
        ),
      })),
    }),
    onError: (error, _input, context) => {
      context?.rollback();
      failed(error);
    },
    onSuccess: (result, input, context) => {
      if (result.ok) {
        toastManager.add({
          type: "success",
          title: input.hidden ? "已隐藏这条消息" : "已恢复这条消息",
          description: appliesAtNextBuild,
        });
        return;
      }
      context?.rollback();
      toastManager.add({
        type: "error",
        title: "操作失败",
        description: moderationErrorText[result.error],
      });
    },
    onSettled: settled,
  });
}
