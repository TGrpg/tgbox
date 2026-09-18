import { env } from "cloudflare:workers";
import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import {
  addBlacklist,
  advanceBroadcast,
  createBroadcast,
  getSettings,
  messageUser,
  removeBlacklist,
  setBroadcastState,
} from "@tgbox/core";
import {
  botUserStats,
  countAudience,
  getBotUserDetail,
  listBotUsers,
  listBroadcasts,
  userFilters,
} from "@tgbox/db";
import { BroadcastAudience } from "@tgbox/shared";
import { z } from "zod";
import { queryKeys } from "@/lib/query-keys.ts";
import { adminMiddleware } from "@/server/middleware.ts";

export const USERS_PAGE_SIZE = 50;

const userId = z.number().int().positive();

const message = z.object({
  text: z.string().max(4096),
  buttonText: z.string().max(40).nullable(),
  buttonUrl: z.string().max(2048).nullable(),
});

const $listUsers = createServerFn({ method: "GET" })
  .middleware([adminMiddleware])
  .inputValidator(
    z.object({
      page: z.number().int().min(1),
      filter: z.enum(userFilters),
      search: z.string().max(100),
    }),
  )
  .handler(({ data, context }) =>
    listBotUsers(context.core.db, { ...data, pageSize: USERS_PAGE_SIZE }),
  );

export type UsersQuery = { page: number; filter: (typeof userFilters)[number]; search: string };

export const usersQueryOptions = (query: UsersQuery) =>
  queryOptions({
    queryKey: [...queryKeys.users, "list", query],
    queryFn: ({ signal }) => $listUsers({ data: query, signal }),
  });

export type UserRow = Awaited<ReturnType<typeof $listUsers>>["rows"][number];

const $getUser = createServerFn({ method: "GET" })
  .middleware([adminMiddleware])
  .inputValidator(z.object({ id: userId }))
  .handler(async ({ data, context }) => {
    const [user, settings] = await Promise.all([
      getBotUserDetail(context.core.db, data.id),
      getSettings(context.core),
    ]);
    if (!user) return null;
    // A forum topic's link is t.me/c/<group id without -100>/<topic id>.
    const group = settings.bot.supportGroupId?.replace(/^-100/, "");
    const supportUrl =
      group && user.supportTopicId !== null
        ? `https://t.me/c/${group}/${user.supportTopicId}`
        : null;
    return { ...user, supportUrl };
  });

export const userQueryOptions = (id: number) =>
  queryOptions({
    queryKey: [...queryKeys.users, "detail", id],
    queryFn: ({ signal }) => $getUser({ data: { id }, signal }),
  });

export type UserDetail = NonNullable<Awaited<ReturnType<typeof $getUser>>>;

const $getUserStats = createServerFn({ method: "GET" })
  .middleware([adminMiddleware])
  .handler(({ context }) => botUserStats(context.core.db, context.core.now()));

export const userStatsQueryOptions = () =>
  queryOptions({
    queryKey: [...queryKeys.users, "stats"],
    queryFn: ({ signal }) => $getUserStats({ signal }),
    staleTime: 30_000,
  });

export const $setUserBlacklisted = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .inputValidator(z.object({ id: userId, blacklisted: z.boolean() }))
  .handler(({ data, context }) => {
    const target = { type: "user" as const, value: String(data.id), actor: context.auth.actor };
    return data.blacklisted
      ? addBlacklist(context.core, { ...target, reason: null })
      : removeBlacklist(context.core, target);
  });

export const $messageUser = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .inputValidator(z.object({ id: userId, message }))
  .handler(({ data, context }) =>
    messageUser(context.core, {
      tgUserId: data.id,
      message: data.message,
      actor: context.auth.actor,
    }),
  );

/* ------------------------------------------------------------------ broadcasts */

const $listBroadcasts = createServerFn({ method: "GET" })
  .middleware([adminMiddleware])
  .handler(({ context }) => listBroadcasts(context.core.db));

export const broadcastsQueryOptions = () =>
  queryOptions({
    queryKey: [...queryKeys.users, "broadcasts"],
    queryFn: ({ signal }) => $listBroadcasts({ signal }),
  });

export type BroadcastRow = Awaited<ReturnType<typeof $listBroadcasts>>[number];

const $countAudience = createServerFn({ method: "GET" })
  .middleware([adminMiddleware])
  .inputValidator(z.object({ audience: BroadcastAudience }))
  .handler(({ data, context }) => countAudience(context.core.db, data.audience));

export const audienceQueryOptions = (audience: BroadcastAudience) =>
  queryOptions({
    queryKey: [...queryKeys.users, "audience", audience],
    queryFn: ({ signal }) => $countAudience({ data: { audience }, signal }),
  });

/**
 * Sends the draft to the acting admin only: their own id when signed in through Telegram, else
 * the first id in ADMIN_IDS (Cloudflare Access logins have no Telegram account attached).
 */
export const $previewBroadcast = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .inputValidator(z.object({ message }))
  .handler(async ({ data, context }) => {
    const self = context.auth.actor.startsWith("tg:")
      ? Number(context.auth.actor.slice(3))
      : Number(env.ADMIN_IDS.split(",")[0]?.trim());
    if (!Number.isSafeInteger(self) || self <= 0)
      return { ok: false as const, error: "no_admin_id" as const };
    return messageUser(context.core, {
      tgUserId: self,
      message: data.message,
      actor: context.auth.actor,
    });
  });

export const $createBroadcast = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .inputValidator(z.object({ message, audience: BroadcastAudience }))
  .handler(({ data, context }) =>
    createBroadcast(context.core, { ...data, actor: context.auth.actor }),
  );

/** One batch; the page calls it back to back while a broadcast runs. */
export const $advanceBroadcast = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .inputValidator(z.object({ id: z.number().int().positive() }))
  .handler(async ({ data, context }) => (await advanceBroadcast(context.core, data.id)) ?? null);

export const $setBroadcastState = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .inputValidator(
    z.object({ id: z.number().int().positive(), action: z.enum(["pause", "resume", "cancel"]) }),
  )
  .handler(({ data, context }) =>
    setBroadcastState(context.core, { ...data, actor: context.auth.actor }),
  );
