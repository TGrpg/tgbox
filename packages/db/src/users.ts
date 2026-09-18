import type { BroadcastAudience, BroadcastStatus } from "@tgbox/shared";
import { and, count, desc, eq, gte, inArray, lt, type SQL, sql } from "drizzle-orm";
import { type Db, pageOf } from "./access.ts";
import { botUsers, broadcasts, orders, submissions, supportThreads } from "./schema.ts";

// Admin reads on live D1 (a handful of admins): the user list may scan `bot_users`, which has only
// its primary key; per-user aggregates go through the `submissions_user` / `orders_user` indexes.

const DAY_MS = 24 * 60 * 60 * 1000;

export type BotUser = typeof botUsers.$inferSelect;
export type Broadcast = typeof broadcasts.$inferSelect;

/** Orders that took money and kept it: what "paying user" means everywhere. */
const PAID_STATUSES = ["paid", "active", "expired"] as const;

export const utcDay = (now: number) => new Date(now).toISOString().slice(0, 10);

/**
 * Records a private-chat user. Conditional upsert: 0 rows written when the profile is unchanged
 * and they were already seen today, so the bot pays at most a row per user per day. A user who had
 * blocked the bot and writes again is reachable again.
 */
export async function touchBotUser(
  db: Db,
  user: {
    tgUserId: number;
    firstName: string;
    lastName: string | null;
    username: string | null;
    languageCode: string | null;
    now: number;
  },
) {
  const result = await db
    .insert(botUsers)
    .values({
      tgUserId: user.tgUserId,
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.username,
      languageCode: user.languageCode,
      firstSeenAt: user.now,
      lastSeenDay: utcDay(user.now),
    })
    .onConflictDoUpdate({
      target: botUsers.tgUserId,
      set: {
        firstName: sql`excluded.first_name`,
        lastName: sql`excluded.last_name`,
        username: sql`excluded.username`,
        languageCode: sql`excluded.language_code`,
        lastSeenDay: sql`excluded.last_seen_day`,
        blockedAt: sql`NULL`,
      },
      setWhere: sql`${botUsers.firstName} IS NOT excluded.first_name
        OR ${botUsers.lastName} IS NOT excluded.last_name
        OR ${botUsers.username} IS NOT excluded.username
        OR ${botUsers.languageCode} IS NOT excluded.language_code
        OR ${botUsers.lastSeenDay} IS NOT excluded.last_seen_day
        OR ${botUsers.blockedAt} IS NOT NULL`,
    })
    .run();
  return { rowsWritten: result.meta.rows_written };
}

/** Users whose messages came back 403. */
export async function markBotUsersBlocked(db: Db, ids: number[], now: number) {
  if (ids.length === 0) return;
  await db
    .update(botUsers)
    .set({ blockedAt: now })
    .where(and(inArray(botUsers.tgUserId, ids), sql`${botUsers.blockedAt} IS NULL`))
    .run();
}

/* ------------------------------------------------------------------ admin list */

export const userFilters = ["all", "submitters", "paying", "blacklisted", "blocked"] as const;
export type UserFilter = (typeof userFilters)[number];

const isBlacklisted = sql`EXISTS (SELECT 1 FROM blacklist b WHERE b.type = 'user' AND b.value = CAST(${botUsers.tgUserId} AS TEXT))`;
const hasPaid = sql`EXISTS (SELECT 1 FROM orders o WHERE o.tg_user_id = ${botUsers.tgUserId} AND o.status IN ('paid', 'active', 'expired'))`;
const hasSubmitted = sql`EXISTS (SELECT 1 FROM submissions s WHERE s.tg_user_id = ${botUsers.tgUserId})`;
/** The bot's language for the user: their /lang choice, else English only for `en*` clients. */
const userLocale = sql`COALESCE((SELECT p.locale FROM user_prefs p WHERE p.tg_user_id = ${botUsers.tgUserId}), CASE WHEN lower(${botUsers.languageCode}) LIKE 'en%' THEN 'en' ELSE 'zh' END)`;

function filterWhere(filter: UserFilter): SQL | undefined {
  switch (filter) {
    case "submitters":
      return hasSubmitted;
    case "paying":
      return hasPaid;
    case "blacklisted":
      return isBlacklisted;
    case "blocked":
      return sql`${botUsers.blockedAt} IS NOT NULL`;
    case "all":
      return undefined;
  }
}

/** A numeric search is an exact id; anything else matches @username or name, case-insensitively. */
function searchWhere(search: string): SQL | undefined {
  const term = search.trim().replace(/^@/, "");
  if (!term) return undefined;
  if (/^\d{1,20}$/.test(term)) return eq(botUsers.tgUserId, Number(term));
  const like = `%${term.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return sql`(lower(${botUsers.username}) LIKE ${like} ESCAPE '\\' OR lower(coalesce(${botUsers.firstName}, '') || ' ' || coalesce(${botUsers.lastName}, '')) LIKE ${like} ESCAPE '\\')`;
}

/** Most recently active first, with each user's submission and order totals. */
export async function listBotUsers(
  db: Db,
  query: { page: number; pageSize?: number; filter: UserFilter; search: string },
) {
  const { limit, offset } = pageOf(query.page, query.pageSize ?? 50);
  const where = and(filterWhere(query.filter), searchWhere(query.search));
  const [users, totals] = await db.batch([
    db
      .select({
        user: botUsers,
        blacklisted: sql<number>`${isBlacklisted}`,
        locale: sql<string>`${userLocale}`,
      })
      .from(botUsers)
      .where(where)
      .orderBy(desc(botUsers.lastSeenDay), desc(botUsers.tgUserId))
      .limit(limit)
      .offset(offset),
    db.select({ count: count() }).from(botUsers).where(where),
  ]);
  const ids = users.map((row) => row.user.tgUserId);
  const [subs, paid] =
    ids.length === 0
      ? [[], []]
      : await db.batch([
          db
            .select({ tgUserId: submissions.tgUserId, status: submissions.status, count: count() })
            .from(submissions)
            .where(inArray(submissions.tgUserId, ids))
            .groupBy(submissions.tgUserId, submissions.status),
          db
            .select({
              tgUserId: orders.tgUserId,
              currency: orders.currency,
              count: count(),
              amount: sql<number>`sum(cast(${orders.amount} AS REAL))`,
            })
            .from(orders)
            .where(and(inArray(orders.tgUserId, ids), inArray(orders.status, PAID_STATUSES)))
            .groupBy(orders.tgUserId, orders.currency),
        ]);
  const rows = users.map(({ user, blacklisted, locale }) => {
    const mine = subs.filter((row) => row.tgUserId === user.tgUserId);
    const spend = paid.filter((row) => row.tgUserId === user.tgUserId);
    const submitted = (status: string) =>
      mine.filter((row) => row.status === status).reduce((sum, row) => sum + row.count, 0);
    return {
      ...user,
      locale: locale === "en" ? ("en" as const) : ("zh" as const),
      blacklisted: Boolean(blacklisted),
      submissions: {
        approved: submitted("approved"),
        rejected: submitted("rejected"),
        pending: submitted("pending"),
      },
      orders: spend.reduce((sum, row) => sum + row.count, 0),
      spend: spend.map((row) => ({ currency: row.currency, amount: row.amount ?? 0 })),
    };
  });
  return { rows, total: totals[0]?.count ?? 0 };
}

/** Everything the admin shows for one user; undefined when the bot has never seen them. */
export async function getBotUserDetail(db: Db, tgUserId: number) {
  const [users, subs, userOrders, threads] = await db.batch([
    db
      .select({ user: botUsers, blacklisted: sql<number>`${isBlacklisted}` })
      .from(botUsers)
      .where(eq(botUsers.tgUserId, tgUserId)),
    db
      .select({
        id: submissions.id,
        username: submissions.username,
        kind: submissions.kind,
        status: submissions.status,
        rejectReason: submissions.rejectReason,
        createdAt: submissions.createdAt,
      })
      .from(submissions)
      .where(eq(submissions.tgUserId, tgUserId))
      .orderBy(desc(submissions.id))
      .limit(20),
    db
      .select({
        id: orders.id,
        kind: orders.kind,
        days: orders.days,
        status: orders.status,
        targetUsername: orders.targetUsername,
        amount: orders.amount,
        currency: orders.currency,
        createdAt: orders.createdAt,
        endsAt: orders.endsAt,
      })
      .from(orders)
      .where(eq(orders.tgUserId, tgUserId))
      .orderBy(desc(orders.id))
      .limit(20),
    db
      .select({ topicId: supportThreads.topicId })
      .from(supportThreads)
      .where(eq(supportThreads.tgUserId, tgUserId)),
  ]);
  const [row] = users;
  if (!row) return undefined;
  return {
    ...row.user,
    blacklisted: Boolean(row.blacklisted),
    submissions: subs,
    orders: userOrders,
    supportTopicId: threads[0]?.topicId ?? null,
  };
}

/** Dashboard numbers: all users, users first seen in the last 7 days, users who paid. */
export async function botUserStats(db: Db, now: number) {
  const [all, fresh, paying] = await db.batch([
    db.select({ count: count() }).from(botUsers),
    db
      .select({ count: count() })
      .from(botUsers)
      .where(gte(botUsers.firstSeenAt, now - 7 * DAY_MS)),
    db
      .select({ count: sql<number>`count(DISTINCT ${orders.tgUserId})` })
      .from(orders)
      .where(inArray(orders.status, PAID_STATUSES)),
  ]);
  return {
    total: all[0]?.count ?? 0,
    new7d: fresh[0]?.count ?? 0,
    paying: paying[0]?.count ?? 0,
  };
}

/* ------------------------------------------------------------------ profiles */

/** What the admin shows for a Telegram user wherever one appears; unknown ids are left out. */
export function getBotUserProfiles(db: Db, ids: number[]) {
  if (ids.length === 0) return Promise.resolve([]);
  return db
    .select({
      tgUserId: botUsers.tgUserId,
      firstName: botUsers.firstName,
      lastName: botUsers.lastName,
      username: botUsers.username,
      avatarKey: botUsers.avatarKey,
      avatarCheckedAt: botUsers.avatarCheckedAt,
    })
    .from(botUsers)
    .where(inArray(botUsers.tgUserId, ids));
}

/** Records a fetched profile photo (or that there is none). At most one write per user a week. */
export async function setBotUserAvatar(
  db: Db,
  input: { tgUserId: number; avatarKey: string | null; now: number },
) {
  await db
    .update(botUsers)
    .set({ avatarKey: input.avatarKey, avatarCheckedAt: input.now })
    .where(eq(botUsers.tgUserId, input.tgUserId))
    .run();
}

/* ------------------------------------------------------------------ broadcasts */

/** Reachable users in the audience: not blocked, not blacklisted. `now` dates "active". */
function audienceWhere(audience: BroadcastAudience, now: number): SQL {
  const reachable = sql`${botUsers.blockedAt} IS NULL AND NOT ${isBlacklisted}`;
  switch (audience) {
    case "zh":
    case "en":
      return sql`${reachable} AND ${userLocale} = ${audience}`;
    case "paying":
      return sql`${reachable} AND ${hasPaid}`;
    case "submitters":
      return sql`${reachable} AND ${hasSubmitted}`;
    case "active30":
      return sql`${reachable} AND ${botUsers.lastSeenDay} >= ${utcDay(now - 30 * DAY_MS)}`;
    case "all":
      return reachable;
  }
}

export async function countAudience(db: Db, audience: BroadcastAudience, now: number) {
  const [row] = await db
    .select({ count: count() })
    .from(botUsers)
    .where(audienceWhere(audience, now));
  return row?.count ?? 0;
}

export async function insertBroadcast(
  db: Db,
  input: Pick<
    Broadcast,
    | "text"
    | "format"
    | "media"
    | "buttons"
    | "buttonsPerRow"
    | "silent"
    | "protect"
    | "noPreview"
    | "audience"
    | "total"
    | "createdBy"
  > & {
    now: number;
    /** Scheduled start; nobody sends a batch before it. */
    startAt: number;
  },
) {
  const { now, startAt, ...fields } = input;
  const [row] = await db
    .insert(broadcasts)
    .values({ ...fields, notBefore: startAt, createdAt: now })
    .returning();
  if (!row) throw new Error("broadcast insert returned nothing");
  return row;
}

export async function getBroadcast(db: Db, id: number) {
  const [row] = await db.select().from(broadcasts).where(eq(broadcasts.id, id));
  return row;
}

export async function listBroadcasts(db: Db, limit = 20) {
  return db.select().from(broadcasts).orderBy(desc(broadcasts.id)).limit(limit);
}

/** Running broadcasts whose back-off has passed, oldest first: the cron's work list. */
export async function listDueBroadcasts(db: Db, now: number) {
  return db
    .select()
    .from(broadcasts)
    .where(and(eq(broadcasts.status, "running"), lt(broadcasts.notBefore, now + 1)))
    .orderBy(broadcasts.id);
}

/**
 * Claims the next `limit` recipients after the broadcast's cursor: moves the cursor past them and
 * takes a lease (`not_before`) until the batch is recorded. Both are conditional on the cursor it
 * read, so a concurrent sender (admin page and cron at once) gets `null` instead of the same
 * people. A sender that dies mid-batch loses those recipients once the lease runs out — a
 * broadcast is at-most-once. An empty batch means everyone has been reached.
 */
export async function claimBroadcastBatch(
  db: Db,
  broadcast: Pick<Broadcast, "id" | "cursor" | "audience">,
  input: { limit: number; now: number; leaseMs: number },
) {
  const { limit, now } = input;
  const recipients = await db
    .select({ tgUserId: botUsers.tgUserId })
    .from(botUsers)
    .where(
      and(sql`${botUsers.tgUserId} > ${broadcast.cursor}`, audienceWhere(broadcast.audience, now)),
    )
    .orderBy(botUsers.tgUserId)
    .limit(limit);
  const last = recipients.at(-1)?.tgUserId;
  if (last === undefined) return [];
  const claimed = await db
    .update(broadcasts)
    .set({ cursor: last, notBefore: now + input.leaseMs })
    .where(
      and(
        eq(broadcasts.id, broadcast.id),
        eq(broadcasts.cursor, broadcast.cursor),
        eq(broadcasts.status, "running"),
        lt(broadcasts.notBefore, now + 1),
      ),
    )
    .run();
  return claimed.meta.changes === 1 ? recipients.map((row) => row.tgUserId) : null;
}

/**
 * Adds a batch's outcome and releases the lease. `rewindTo` hands unsent recipients back (Telegram
 * rate-limited us part way) with `notBefore` as the back-off; `done` finishes the broadcast.
 */
export async function recordBroadcastBatch(
  db: Db,
  input: {
    id: number;
    sent: number;
    failed: number;
    blocked: number;
    rewindTo?: number;
    notBefore?: number;
    done: boolean;
    now: number;
  },
) {
  await db
    .update(broadcasts)
    .set({
      sent: sql`${broadcasts.sent} + ${input.sent}`,
      failed: sql`${broadcasts.failed} + ${input.failed}`,
      blocked: sql`${broadcasts.blocked} + ${input.blocked}`,
      ...(input.rewindTo === undefined ? {} : { cursor: input.rewindTo }),
      notBefore: input.notBefore ?? 0,
      ...(input.done
        ? {
            status: sql`CASE WHEN ${broadcasts.status} = 'running' THEN 'done' ELSE ${broadcasts.status} END`,
            finishedAt: input.now,
          }
        : {}),
    })
    .where(eq(broadcasts.id, input.id))
    .run();
}

/** State-machine transition; false when the broadcast wasn't in `from`. */
export async function setBroadcastStatus(
  db: Db,
  input: { id: number; from: BroadcastStatus; to: BroadcastStatus; now: number },
) {
  const finished = input.to === "done" || input.to === "cancelled";
  const result = await db
    .update(broadcasts)
    .set({ status: input.to, ...(finished ? { finishedAt: input.now } : {}) })
    .where(and(eq(broadcasts.id, input.id), eq(broadcasts.status, input.from)))
    .run();
  return result.meta.changes === 1;
}
