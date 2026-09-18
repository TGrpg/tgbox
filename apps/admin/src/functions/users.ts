import { env } from "cloudflare:workers";
import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import {
  AVATAR_MAX_AGE_MS,
  addBlacklist,
  advanceBroadcast,
  createBroadcast,
  getSettings,
  messageUser,
  previewMessage,
  refreshUserAvatars,
  removeBlacklist,
  setBroadcastState,
  uploadMessageMedia,
} from "@tgbox/core";
import {
  botUserStats,
  countAudience,
  getBotUserDetail,
  getBotUserProfiles,
  listBotUsers,
  listBroadcasts,
  userFilters,
} from "@tgbox/db";
import {
  BroadcastAudience,
  BroadcastFormat,
  BroadcastMedia,
  BroadcastMediaType,
  type OutgoingMessage,
} from "@tgbox/shared";
import { z } from "zod";
import { queryKeys } from "@/lib/query-keys.ts";
import { adminMiddleware } from "@/server/middleware.ts";

export const USERS_PAGE_SIZE = 50;

const userId = z.number().int().positive();

/** Shape only; core validates the content (limits, links) and answers `invalid`. */
const message = z.object({
  text: z.string().max(4096),
  format: BroadcastFormat,
  media: BroadcastMedia.nullable(),
  buttons: z.array(z.object({ text: z.string().max(100), url: z.string().max(2048) })).max(8),
  buttonsPerRow: z.number().int().min(1).max(3),
  silent: z.boolean(),
  protect: z.boolean(),
  noPreview: z.boolean(),
}) satisfies z.ZodType<OutgoingMessage>;

/**
 * Where drafts go for a preview: the acting admin's own chat when signed in through Telegram, else
 * the first id in ADMIN_IDS (Cloudflare Access logins have no Telegram account attached).
 */
function selfChatId(actor: string) {
  const id = actor.startsWith("tg:")
    ? Number(actor.slice(3))
    : Number(env.ADMIN_IDS.split(",")[0]?.trim());
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

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

const PROFILE_BATCH = 50;

/**
 * Name, @username and avatar of the Telegram users a page shows, in one request per page. Avatars
 * older than a week (or never fetched) are refreshed first, a few per request, so a page fills in
 * over a couple of loads without ever running past the invocation's subrequest budget.
 */
const $getUserProfiles = createServerFn({ method: "GET" })
  .middleware([adminMiddleware])
  .inputValidator(z.object({ ids: z.array(userId).max(PROFILE_BATCH) }))
  .handler(async ({ data, context }) => {
    const { db } = context.core;
    const now = context.core.now();
    let rows = await getBotUserProfiles(db, data.ids);
    const stale = rows.filter(
      (row) => row.avatarCheckedAt === null || row.avatarCheckedAt < now - AVATAR_MAX_AGE_MS,
    );
    if (stale.length > 0 && env.SETTINGS_KEY) {
      await refreshUserAvatars(context.core, {
        users: stale,
        media: env.MEDIA,
        secret: env.SETTINGS_KEY,
      });
      rows = await getBotUserProfiles(db, data.ids);
    }
    return rows.map((row) => ({
      tgUserId: row.tgUserId,
      name: [row.firstName, row.lastName].filter(Boolean).join(" ") || null,
      username: row.username,
      avatarUrl: row.avatarKey ? `${env.R2_PUBLIC_URL}/${row.avatarKey}` : null,
    }));
  });

export type UserProfile = Awaited<ReturnType<typeof $getUserProfiles>>[number];

/**
 * Collects the ids asked for in the same tick into one request, so fifty avatars on a page cost
 * one call instead of fifty. Ids the bot has never met resolve to null.
 */
type Waiter = { resolve: (profile: UserProfile | null) => void; reject: (error: unknown) => void };
const waiting = new Map<number, Waiter[]>();
let flushing: ReturnType<typeof setTimeout> | undefined;

function flushProfiles() {
  flushing = undefined;
  const batch = new Map(waiting);
  waiting.clear();
  const ids = [...batch.keys()];
  for (let i = 0; i < ids.length; i += PROFILE_BATCH) {
    const chunk = ids.slice(i, i + PROFILE_BATCH);
    const settle = (each: (waiter: Waiter, id: number) => void) => {
      for (const id of chunk) for (const waiter of batch.get(id) ?? []) each(waiter, id);
    };
    $getUserProfiles({ data: { ids: chunk } })
      .then((rows) => {
        const byId = new Map(rows.map((row) => [row.tgUserId, row]));
        settle((waiter, id) => waiter.resolve(byId.get(id) ?? null));
      })
      // Rejected, not resolved to null: the query retries instead of caching "unknown user".
      .catch((error: unknown) => settle((waiter) => waiter.reject(error)));
  }
}

export const userProfileQueryOptions = (id: number) =>
  queryOptions({
    queryKey: [...queryKeys.users, "profile", id],
    queryFn: () =>
      new Promise<UserProfile | null>((resolve, reject) => {
        waiting.set(id, [...(waiting.get(id) ?? []), { resolve, reject }]);
        if (flushing === undefined) flushing = setTimeout(flushProfiles, 10);
      }),
    staleTime: 10 * 60_000,
  });

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
  .handler(({ data, context }) =>
    countAudience(context.core.db, data.audience, context.core.now()),
  );

export const audienceQueryOptions = (audience: BroadcastAudience) =>
  queryOptions({
    queryKey: [...queryKeys.users, "audience", audience],
    queryFn: ({ signal }) => $countAudience({ data: { audience }, signal }),
  });

export const $previewBroadcast = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .inputValidator(z.object({ message }))
  .handler(async ({ data, context }) => {
    const chatId = selfChatId(context.auth.actor);
    if (chatId === null) return { ok: false as const, error: "no_admin_id" as const };
    return previewMessage(context.core, { chatId, message: data.message });
  });

/**
 * A picked file goes to Telegram once, as the preview itself; the returned file id is what the
 * broadcast then sends to everyone.
 */
export const $uploadBroadcastMedia = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .inputValidator((data: unknown) => {
    if (!(data instanceof FormData)) throw new Error("expected form data");
    const file = data.get("file");
    if (!(file instanceof File) || file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
      throw new Error("file missing or larger than 20 MB");
    }
    return {
      file,
      type: BroadcastMediaType.parse(data.get("type")),
      message: message.parse(JSON.parse(String(data.get("message") ?? "null"))),
    };
  })
  .handler(async ({ data, context }) => {
    const chatId = selfChatId(context.auth.actor);
    if (chatId === null) return { ok: false as const, error: "no_admin_id" };
    return uploadMessageMedia(context.core, {
      chatId,
      type: data.type,
      file: data.file,
      filename: data.file.name || "file",
      message: data.message,
    });
  });

export const $createBroadcast = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .inputValidator(
    z.object({ message, audience: BroadcastAudience, startAt: z.number().int().nullable() }),
  )
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
