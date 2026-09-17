import { useQuery } from "@tanstack/react-query";
import { EyeIcon, EyeOffIcon, ImageOffIcon } from "lucide-react";
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
import { SwitchRow } from "@/features/settings/fields.tsx";
import type { EntryRow } from "@/functions/entries.ts";
import { type EntryPost, entryPostsQueryOptions } from "@/functions/posts.ts";
import { useSetEntryPostsVisibility, useSetPostVisibility } from "./mutations.ts";
import { useIsMobile } from "./use-is-mobile.ts";

/** Post previews of one channel, with the per-entry and per-post switches the site build reads. */
export function EntryPostsSheet({
  entry,
  onClose,
}: {
  entry: EntryRow | null;
  onClose: () => void;
}) {
  const mobile = useIsMobile();
  return (
    <Sheet open={entry !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetPopup side={mobile ? "bottom" : "right"} className="md:max-w-lg">
        {entry && <PostsPanel key={entry.id} entry={entry} />}
      </SheetPopup>
    </Sheet>
  );
}

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("zh-CN", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

function PostsPanel({ entry }: { entry: EntryRow }) {
  const view = useQuery(entryPostsQueryOptions(entry.username));
  const setEntryPosts = useSetEntryPostsVisibility();
  const setPost = useSetPostVisibility(entry.username);
  const data = view.data?.ok ? view.data : undefined;
  const hideAll = data?.hidePosts ?? entry.hidePosts;

  return (
    <>
      <SheetHeader>
        <SheetTitle>最近消息</SheetTitle>
        <SheetDescription>
          {entry.title} · @{entry.username}
        </SheetDescription>
      </SheetHeader>
      <SheetPanel className="flex flex-col gap-4">
        <SwitchRow
          label="不显示最近消息"
          hint="打开后详情页不再显示这个频道的消息。下次网站构建后生效。"
          checked={hideAll}
          onChange={(hide) =>
            setEntryPosts.mutate({ id: entry.id, username: entry.username, hide })
          }
        />
        {data?.hidePostMedia && (
          <p className="flex items-center gap-2 text-muted-foreground text-xs">
            <ImageOffIcon className="size-3.5 shrink-0" aria-hidden />
            设置里开启了「隐藏消息图片」，全站的消息图片都不会显示。
          </p>
        )}

        {view.isPending ? (
          <div className="flex flex-col gap-2">
            {["a", "b", "c"].map((key) => (
              <Skeleton key={key} className="h-20 rounded-xl" />
            ))}
          </div>
        ) : view.isError ? (
          <p className="text-destructive-foreground text-sm">加载失败：{view.error.message}</p>
        ) : !data ? (
          <p className="text-destructive-foreground text-sm">条目不存在</p>
        ) : data.posts.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            R2 里还没有这个频道的消息快照，可以先「立即刷新」再回来。
          </p>
        ) : (
          <ul className={hideAll ? "flex flex-col gap-2 opacity-60" : "flex flex-col gap-2"}>
            {data.posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                username={entry.username}
                pending={setPost.isPending}
                onToggle={(hidden) => setPost.mutate({ postId: post.id, hidden })}
              />
            ))}
          </ul>
        )}
      </SheetPanel>
    </>
  );
}

function PostCard({
  post,
  username,
  pending,
  onToggle,
}: {
  post: EntryPost;
  username: string;
  pending: boolean;
  onToggle: (hidden: boolean) => void;
}) {
  return (
    <li
      className={`rounded-xl border p-3 text-sm ${post.hidden ? "bg-muted/40 text-muted-foreground" : ""}`}
    >
      <div className="mb-1.5 flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
        <a
          href={`https://t.me/${username}/${post.id}`}
          target="_blank"
          rel="noreferrer"
          className="hover:underline"
        >
          {dateTime(post.date)}
        </a>
        {post.views !== null && <span className="tabular-nums">{post.views} 次浏览</span>}
        {post.hidden && <Badge variant="secondary">已隐藏</Badge>}
        {post.blocked && !post.hidden && <Badge variant="warning">关键词过滤</Badge>}
      </div>
      <p className="line-clamp-4 whitespace-pre-line break-words">{post.text || "（媒体）"}</p>
      <div className="mt-2 flex justify-end">
        <Button
          size="sm"
          variant={post.hidden ? "outline" : "ghost"}
          disabled={pending}
          onClick={() => onToggle(!post.hidden)}
        >
          {post.hidden ? <EyeIcon aria-hidden /> : <EyeOffIcon aria-hidden />}
          {post.hidden ? "恢复" : "隐藏这条"}
        </Button>
      </div>
    </li>
  );
}
