import { env } from "cloudflare:workers";
import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { getSettings, setEntryPostsVisibility, setPostVisibility } from "@tgbox/core";
import { getEntryByUsername, listHiddenPostIds } from "@tgbox/db";
import { PostView, shouldHidePost } from "@tgbox/shared";
import { z } from "zod";
import { queryKeys } from "@/lib/query-keys.ts";
import { adminMiddleware } from "@/server/middleware.ts";

const username = z.string().regex(/^[A-Za-z0-9_]{4,32}$/);
const postId = z.number().int().positive();

/**
 * The post previews the last refresh wrote to R2, annotated with what the site build would do to
 * them. One R2 read per call, so the panel is opened on demand and not polled.
 */
const $listEntryPosts = createServerFn({ method: "GET" })
  .middleware([adminMiddleware])
  .inputValidator(z.object({ username }))
  .handler(async ({ data, context }) => {
    const entry = await getEntryByUsername(context.core.db, data.username);
    if (!entry) return { ok: false as const, error: "not_found" as const };
    const [hiddenIds, settings, object] = await Promise.all([
      listHiddenPostIds(context.core.db, entry.id),
      getSettings(context.core),
      env.MEDIA.get(`posts/${entry.username}.json`),
    ]);
    const parsed = PostView.array().safeParse(object ? await object.json() : []);
    const hidden = new Set(hiddenIds);
    return {
      ok: true as const,
      hidePosts: entry.hidePosts,
      hidePostMedia: settings.site.hidePostMedia,
      posts: (parsed.success ? parsed.data : []).map((post) => ({
        ...post,
        hidden: hidden.has(post.id),
        blocked: shouldHidePost(post.text, settings.site.postBlocklist),
      })),
    };
  });

export type EntryPostsView = Awaited<ReturnType<typeof $listEntryPosts>>;
export type EntryPost = Extract<EntryPostsView, { ok: true }>["posts"][number];

export const entryPostsQueryOptions = (entryUsername: string) =>
  queryOptions({
    queryKey: [...queryKeys.entryPosts, entryUsername],
    queryFn: ({ signal }) => $listEntryPosts({ data: { username: entryUsername }, signal }),
    staleTime: 60_000,
  });

export const $setEntryPostsVisibility = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .inputValidator(z.object({ username, hide: z.boolean() }))
  .handler(({ data, context }) =>
    setEntryPostsVisibility(context.core, {
      username: data.username,
      hide: data.hide,
      actor: context.auth.actor,
    }),
  );

export const $setPostVisibility = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .inputValidator(z.object({ username, postId, hidden: z.boolean() }))
  .handler(({ data, context }) =>
    setPostVisibility(context.core, {
      username: data.username,
      postId: data.postId,
      hidden: data.hidden,
      actor: context.auth.actor,
    }),
  );
