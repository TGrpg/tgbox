import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { approveFriendLink, getSettings, rejectFriendLink, setFriendLinks } from "@tgbox/core";
import { listFriendLinkRequests } from "@tgbox/db";
import { FriendLink, MAX_FRIEND_LINKS } from "@tgbox/shared";
import { z } from "zod";
import { queryKeys } from "@/lib/query-keys.ts";
import { adminMiddleware } from "@/server/middleware.ts";

export const FRIEND_LINK_REQUESTS_PAGE_SIZE = 20;

const $getFriendLinks = createServerFn({ method: "GET" })
  .middleware([adminMiddleware])
  .handler(async ({ context }) => (await getSettings(context.core)).site.friendLinks);

export const friendLinksQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.friendLinks,
    queryFn: ({ signal }) => $getFriendLinks({ signal }),
  });

const $listFriendLinkRequests = createServerFn({ method: "GET" })
  .middleware([adminMiddleware])
  .inputValidator(z.object({ page: z.number().int().min(1) }))
  .handler(({ data, context }) =>
    listFriendLinkRequests(context.core.db, {
      page: data.page,
      pageSize: FRIEND_LINK_REQUESTS_PAGE_SIZE,
    }),
  );

export const friendLinkRequestsQueryOptions = (page = 1) =>
  queryOptions({
    queryKey: [...queryKeys.friendLinkRequests, page],
    queryFn: ({ signal }) => $listFriendLinkRequests({ data: { page }, signal }),
  });

export type FriendLinkRequestRow = Awaited<
  ReturnType<typeof $listFriendLinkRequests>
>["rows"][number];

export const $saveFriendLinks = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .inputValidator(z.object({ links: z.array(FriendLink).max(MAX_FRIEND_LINKS) }))
  .handler(({ data, context }) =>
    setFriendLinks(context.core, { links: data.links, actor: context.auth.actor }),
  );

/** "handled" when another admin (or the bot button) got there first. */
export const $reviewFriendLink = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .inputValidator(z.object({ id: z.number().int(), approve: z.boolean() }))
  .handler(async ({ data, context }) => {
    const input = { id: data.id, actor: context.auth.actor };
    if (!data.approve) return (await rejectFriendLink(context.core, input)) ? "ok" : "handled";
    const result = await approveFriendLink(context.core, input);
    return result === null ? "handled" : result.ok ? "ok" : "full";
  });
