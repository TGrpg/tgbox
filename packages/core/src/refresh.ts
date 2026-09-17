import {
  type ColdFields,
  createDb,
  type Db,
  type Entry,
  type EntryStats,
  getEntriesByIdRange,
  getMaxEntryId,
  markDirty,
  recordLivenessResult,
  updateEntryCold,
  upsertEntryStats,
} from "@tgbox/db";
import { type Liveness, MemberPoint, type PostView } from "@tgbox/shared";
import { type EntrySnapshot, fetchEntrySnapshot } from "@tgbox/telegram";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
type RefreshDeps = { fetch: Fetch };

/** The R2 operations refresh needs; the bot's and the admin's `MEDIA` binding both satisfy it. */
export type MediaBucket = Pick<R2Bucket, "get" | "head" | "put">;

/** Where one entry's refresh writes to. */
type RefreshIo = { db: Db; fetch: Fetch; media: MediaBucket };

/** Counters of one refresh (a cron batch or a single manual refresh). */
type RefreshTally = {
  rowsWritten: number;
  r2Writes: number;
  subrequests: number;
  /** something the static site shows changed */
  dirty: boolean;
};

const MINUTE_MS = 60_000;
const WEEK_MS = 7 * 24 * 60 * MINUTE_MS;
const DEFAULT_BATCH_SIZE = 6;

// Free plan: 50 subrequests per invocation (fetch + D1 + R2). Stay under 45.
const SUBREQUEST_BUDGET = 45;
// Worst case for one entry: 3 t.me pages + avatar get/put + posts head/put
// + history get/put + cold, stats and liveness writes.
const ENTRY_WORST_CASE = 12;
// markDirty + admin summary at the end of the run.
const FINAL_RESERVE = 2;

// A single batch is 5–10 entries, so "more than 5% failed" is any failure at all;
// instead treat ≥ 2 definitive failures in one batch as a likely Telegram-side/parser issue:
// failures are still counted, but no entry is hidden this run.
const GUARD_MIN_FAILURES = 2;

type RefreshResult = RefreshTally & {
  from: number;
  to: number;
  processed: string[];
  /** entries left for a later slot because of the subrequest budget or a 429 */
  deferred: string[];
  hidden: string[];
  restored: string[];
};

// Only the bindings the cron uses; the bot's `Env` satisfies it. REFRESH_BATCH_SIZE is optional.
type RefreshEnv = {
  DB: D1Database;
  MEDIA: MediaBucket;
  BOT_TOKEN: string;
  ADMIN_CHAT_ID: string;
  REFRESH_BATCH_SIZE?: string;
};

function batchSizeOf(env: RefreshEnv) {
  const size = Number(env.REFRESH_BATCH_SIZE);
  return Number.isInteger(size) && size > 0 ? size : DEFAULT_BATCH_SIZE;
}

async function sha256(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Telegram serves the same avatar under a stable file path; query strings are ignored.
async function avatarFingerprint(url: string) {
  return (await sha256(new URL(url).pathname)).slice(0, 16);
}

const onlineBucket = (online: number | null) =>
  online === null ? null : Math.floor(Math.log2(online + 1));

function statsDue(
  previous: EntryStats | null,
  next: { members: number | null; online: number | null; activityTier: EntryStats["activityTier"] },
  now: number,
  manual: boolean,
) {
  if (!previous) return true;
  const unchanged =
    previous.members === next.members &&
    previous.online === next.online &&
    previous.activityTier === next.activityTier;
  if (unchanged) return false;
  // An admin asking for a refresh wants to see the current numbers, not the write-throttled ones.
  if (manual) return true;
  if (previous.activityTier !== next.activityTier) return true;
  if (onlineBucket(previous.online) !== onlineBucket(next.online)) return true;
  if (now - previous.statsWrittenAt >= WEEK_MS) return true;
  if (previous.members === null || next.members === null) return previous.members !== next.members;
  if (previous.members === 0) return next.members !== 0;
  return Math.abs(next.members - previous.members) / previous.members >= 0.01;
}

type Pending = { entry: Entry; username: string; liveness: Liveness };

export async function runRefresh(
  env: RefreshEnv,
  scheduledTime: number,
  // Wrapped: workerd throws "Illegal invocation" when fetch is called as a method of another object.
  deps: RefreshDeps = { fetch: (input, init) => fetch(input, init) },
): Promise<RefreshResult> {
  const db = createDb(env.DB);
  const now = scheduledTime;
  const result: RefreshResult = {
    from: 0,
    to: -1,
    processed: [],
    deferred: [],
    hidden: [],
    restored: [],
    rowsWritten: 0,
    r2Writes: 0,
    subrequests: 0,
    dirty: false,
  };

  // Deterministic time slice: no cursor is stored, the slot comes from the clock.
  const maxId = await getMaxEntryId(db);
  result.subrequests++;
  if (maxId === 0) return result;
  const batchSize = batchSizeOf(env);
  const batches = Math.ceil(maxId / batchSize);
  const minute = Math.floor(scheduledTime / MINUTE_MS);
  const slot = minute % batches;
  // One cycle = one full pass over all slots; low-activity channels are refreshed every other pass.
  const oddCycle = Math.floor(minute / batches) % 2 === 1;
  result.from = slot * batchSize + 1;
  result.to = result.from + batchSize - 1;

  const rows = await getEntriesByIdRange(db, result.from, result.to);
  result.subrequests++;

  const pending: Pending[] = [];
  let rateLimited = false;
  for (const { entry, stats } of rows) {
    if (entry.status === "removed" || entry.status === "hidden_by_admin") continue;
    if (oddCycle && (stats?.activityTier === 0 || stats?.activityTier === 1)) continue;
    if (rateLimited || result.subrequests + ENTRY_WORST_CASE + FINAL_RESERVE > SUBREQUEST_BUDGET) {
      result.deferred.push(entry.username);
      continue;
    }

    const snapshot = await fetchEntrySnapshot(entry.username, {
      fetch: deps.fetch,
      now: new Date(now),
      knownKind: entry.kind,
      needCreatedAt: entry.tgCreatedAt === null,
    });
    result.subrequests += snapshot.subrequests;
    result.processed.push(entry.username);
    rateLimited = snapshot.rateLimited;

    if (snapshot.liveness === "active" && snapshot.profile) {
      const io = { db, fetch: deps.fetch, media: env.MEDIA };
      await applyActiveSnapshot(io, { entry, stats, snapshot, now, manual: false }, result);
    }

    const clean =
      snapshot.liveness === "active" &&
      entry.status !== "hidden_by_system" &&
      entry.failCount === 0 &&
      entry.liveness === "active";
    if (snapshot.liveness !== "unknown" && !clean) {
      result.subrequests++;
      pending.push({ entry, username: entry.username, liveness: snapshot.liveness });
    }
  }

  const failures = pending.filter((item) => item.liveness !== "active").length;
  const allowHide = failures < GUARD_MIN_FAILURES;
  for (const item of pending) {
    const outcome = await recordLivenessResult(db, item.entry, {
      liveness: item.liveness,
      now,
      allowHide,
    });
    result.rowsWritten += outcome.rowsWritten;
    if (outcome.transition === "hidden") result.hidden.push(item.username);
    if (outcome.transition === "restored") result.restored.push(item.username);
    if (outcome.transition) result.dirty = true;
  }

  if (result.dirty) {
    await markDirty(db, now);
    result.subrequests++;
  }
  if (result.hidden.length > 0 && env.ADMIN_CHAT_ID) {
    await notifyAdmins(env, deps, pending, result.hidden);
    result.subrequests++;
  }
  return result;
}

/**
 * Applies an active t.me snapshot to one entry: cold fields, stats (D1) and avatar, posts and
 * member history (R2). Shared by the cron batch and the admin's "refresh now".
 */
export async function applyActiveSnapshot(
  io: RefreshIo,
  input: {
    entry: Entry;
    stats: EntryStats | null;
    snapshot: EntrySnapshot;
    now: number;
    /** admin "refresh now": skip the write throttles meant for the cron */
    manual: boolean;
  },
  result: RefreshTally,
) {
  const { entry, stats, snapshot, now, manual } = input;
  const { db } = io;
  const profile = snapshot.profile;
  if (!profile) return;
  const username = entry.username;

  // Cold fields: diffed here so an unchanged entry costs no D1 call.
  const fields: ColdFields = {};
  const title = profile.title ?? entry.title;
  if (title !== entry.title) fields.title = title;
  const description = profile.description ?? "";
  if (description !== entry.description) fields.description = description;
  if (snapshot.lang !== null && snapshot.lang !== entry.lang) fields.lang = snapshot.lang;
  if (profile.verified !== entry.verified) fields.verified = profile.verified;
  if (entry.tgCreatedAt === null && snapshot.createdAt !== null) {
    const createdAt = Date.parse(snapshot.createdAt);
    if (Number.isFinite(createdAt)) fields.tgCreatedAt = createdAt;
  }
  if (profile.avatarUrl === null) {
    if (entry.avatarVersion !== null) fields.avatarVersion = null;
  } else {
    const version = await avatarFingerprint(profile.avatarUrl);
    if (version !== entry.avatarVersion) {
      // Only record the new version once the image is stored, so a failed download is retried.
      if (await storeAvatar(io, username, profile.avatarUrl, result)) {
        fields.avatarVersion = version;
      }
    }
  }
  if (Object.keys(fields).length > 0) {
    const { rowsWritten } = await updateEntryCold(db, entry.id, fields, now);
    result.subrequests++;
    result.rowsWritten += rowsWritten;
    if (rowsWritten > 0) result.dirty = true;
  }

  const kind = snapshot.kind ?? entry.kind;
  const next = {
    members: kind === "bot" ? profile.monthlyUsers : profile.members,
    online: kind === "group" ? profile.online : null,
    activityTier:
      kind === "channel" ? (snapshot.activityTier ?? stats?.activityTier ?? null) : null,
  };
  let statsWritten = false;
  if (statsDue(stats, next, now, manual)) {
    const { rowsWritten } = await upsertEntryStats(db, {
      entryId: entry.id,
      ...next,
      statsWrittenAt: now,
    });
    result.subrequests++;
    result.rowsWritten += rowsWritten;
    statsWritten = rowsWritten > 0;
    if (statsWritten) result.dirty = true;
  }

  // Member trend: a weekly point. Only looked at when stats moved or are a week old.
  const members = next.members;
  const lastStatsAt = statsWritten ? now : (stats?.statsWrittenAt ?? now);
  if (members !== null && (statsWritten || now - lastStatsAt >= WEEK_MS)) {
    await appendHistory(io.media, username, members, now, result);
  }

  if (snapshot.posts !== null) {
    await storePosts(io.media, username, snapshot.posts, { now, manual }, result);
  }
}

async function storeAvatar(io: RefreshIo, username: string, url: string, result: RefreshTally) {
  result.subrequests++;
  let body: ArrayBuffer;
  let contentType: string;
  try {
    const res = await io.fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return false;
    contentType = res.headers.get("content-type") ?? "image/jpeg";
    body = await res.arrayBuffer();
  } catch {
    return false;
  }
  await io.media.put(`avatars/${username}.jpg`, body, { httpMetadata: { contentType } });
  result.subrequests++;
  result.r2Writes++;
  return true;
}

// Posts are rewritten for fresher view counts at most this often; views alone never mark dirty.
const POSTS_VIEWS_REFRESH_MS = 24 * 60 * MINUTE_MS;

async function storePosts(
  media: MediaBucket,
  username: string,
  posts: PostView[],
  { now, manual }: { now: number; manual: boolean },
  result: RefreshTally,
) {
  const key = `posts/${username}.json`;
  const json = JSON.stringify(posts);
  // `hash` covers what the site shows as content; `fullHash` also covers the volatile view counts.
  const hash = await sha256(JSON.stringify(posts.map(({ views: _views, ...post }) => post)));
  const fullHash = await sha256(json);
  const head = await media.head(key);
  result.subrequests++;
  const stored = head?.customMetadata;
  const contentChanged = stored?.hash !== hash;
  const writtenAt = Number(stored?.writtenAt);
  const viewsStale =
    stored?.fullHash !== fullHash &&
    (manual || !Number.isFinite(writtenAt) || now - writtenAt >= POSTS_VIEWS_REFRESH_MS);
  if (!contentChanged && !viewsStale) return;
  await media.put(key, json, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { hash, fullHash, writtenAt: String(now) },
  });
  result.subrequests++;
  result.r2Writes++;
  if (contentChanged) result.dirty = true;
}

async function appendHistory(
  media: MediaBucket,
  username: string,
  members: number,
  now: number,
  result: RefreshTally,
) {
  const key = `history/${username}.json`;
  const object = await media.get(key);
  result.subrequests++;
  let points: MemberPoint[] = [];
  if (object) {
    const parsed = MemberPoint.array().safeParse(await object.json().catch(() => null));
    if (parsed.success) points = parsed.data;
  }
  const last = points.at(-1);
  if (last && now - Date.parse(last.t) < WEEK_MS) return;
  points.push({ t: new Date(now).toISOString(), members });
  await media.put(key, JSON.stringify(points), {
    httpMetadata: { contentType: "application/json" },
  });
  result.subrequests++;
  result.r2Writes++;
}

async function notifyAdmins(
  env: RefreshEnv,
  deps: RefreshDeps,
  pending: Pending[],
  hidden: string[],
) {
  const reasons = new Map(pending.map((item) => [item.username, item.liveness]));
  const lines = hidden.map((username) => `@${username} (${reasons.get(username)})`);
  const text = `系统已隐藏 ${hidden.length} 个失效条目：\n${lines.join("\n")}`;
  try {
    await deps.fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: env.ADMIN_CHAT_ID, text }),
    });
  } catch {
    // Best effort: the hide itself is already recorded.
  }
}
