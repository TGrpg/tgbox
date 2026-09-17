import {
  getEntryByUsername,
  getEntryWithStats,
  insertApprovedEntry,
  listCategories,
  listTags,
  recordLivenessResult,
  setEntryCategory,
  setEntryPromoted,
  setEntryStatus,
  setEntryTags,
} from "@tgbox/db";
import { type EntryStatus, entryKinds, MAX_TAGS, parseTelegramRef } from "@tgbox/shared";
import { fetchEntrySnapshot } from "@tgbox/telegram";
import { audit } from "./audit.ts";
import { markDirtyAndDispatch } from "./build.ts";
import type { Actor, CoreContext } from "./context.ts";
import { applyActiveSnapshot, type MediaBucket } from "./refresh.ts";

/** Bulk status change. Returns the ids whose status actually changed. */
export async function setEntriesStatus(
  ctx: CoreContext,
  input: { ids: number[]; status: EntryStatus; actor: Actor },
) {
  const now = ctx.now();
  const changed: number[] = [];
  for (const id of new Set(input.ids)) {
    if (await setEntryStatus(ctx.db, id, input.status, now)) changed.push(id);
  }
  if (changed.length > 0) {
    await audit(ctx, input.actor, "entry.status", entriesTarget(changed), {
      ids: changed,
      status: input.status,
    });
    await markDirtyAndDispatch(ctx);
  }
  return { changed };
}

/** Bulk promote / unpromote. Returns the ids whose flag actually changed. */
export async function setPromoted(
  ctx: CoreContext,
  input: { ids: number[]; promoted: boolean; actor: Actor },
) {
  const now = ctx.now();
  const changed: number[] = [];
  for (const id of new Set(input.ids)) {
    if (await setEntryPromoted(ctx.db, id, input.promoted, now)) changed.push(id);
  }
  if (changed.length > 0) {
    await audit(ctx, input.actor, "entry.promote", entriesTarget(changed), {
      ids: changed,
      promoted: input.promoted,
    });
    await markDirtyAndDispatch(ctx);
  }
  return { changed };
}

/**
 * Sets an entry's category and/or tags (ids already validated by the caller against the taxonomy).
 * Omitted fields are left alone.
 */
export async function setEntryCategoryAndTags(
  ctx: CoreContext,
  input: { id: number; categoryId?: number; tagIds?: number[]; actor: Actor },
) {
  const now = ctx.now();
  const target = `entry:${input.id}`;
  let categoryChanged = false;
  let tagsChanged = false;
  if (input.categoryId !== undefined) {
    categoryChanged = await setEntryCategory(ctx.db, input.id, input.categoryId, now);
    if (categoryChanged) {
      await audit(ctx, input.actor, "entry.category", target, { categoryId: input.categoryId });
    }
  }
  if (input.tagIds !== undefined) {
    tagsChanged = (await setEntryTags(ctx.db, input.id, input.tagIds, now)).rowsWritten > 0;
    if (tagsChanged) await audit(ctx, input.actor, "entry.tags", target, { tagIds: input.tagIds });
  }
  if (categoryChanged || tagsChanged) await markDirtyAndDispatch(ctx);
  return { categoryChanged, tagsChanged };
}

export type ListEntryError =
  | "invalid_username"
  | "already_listed"
  | "unknown_category"
  | "unknown_tags"
  | "too_many_tags"
  | "user_account"
  | "not_found"
  | "banned"
  | "unavailable";

/** Admin "add entry": fetch the t.me profile and list it directly (no submission). */
export async function listEntryManually(
  ctx: CoreContext,
  input: { username: string; categorySlug: string; tagSlugs: string[]; actor: Actor },
): Promise<{ ok: true; entryId: number } | { ok: false; error: ListEntryError }> {
  const username = parseTelegramRef(input.username)?.toLowerCase();
  if (!username) return { ok: false, error: "invalid_username" };
  if (await getEntryByUsername(ctx.db, username)) return { ok: false, error: "already_listed" };
  const slugs = [...new Set(input.tagSlugs)];
  if (slugs.length > MAX_TAGS) return { ok: false, error: "too_many_tags" };
  const allTags = await listTags(ctx.db);
  const tagIds = slugs.flatMap((slug) => allTags.find((tag) => tag.slug === slug)?.id ?? []);
  if (tagIds.length !== slugs.length) return { ok: false, error: "unknown_tags" };

  const now = ctx.now();
  const snap = await fetchEntrySnapshot(username, {
    fetch: ctx.fetch,
    now: new Date(now),
    knownKind: null,
    needCreatedAt: true,
  });
  if (snap.kind === "user") return { ok: false, error: "user_account" };
  if (snap.liveness === "not_found") return { ok: false, error: "not_found" };
  if (snap.liveness === "banned") return { ok: false, error: "banned" };
  const kind = entryKinds.find((k) => k === snap.kind);
  const profile = snap.profile;
  if (snap.liveness !== "active" || !kind || !profile) return { ok: false, error: "unavailable" };

  const category = (await listCategories(ctx.db)).find(
    (row) => row.kind === kind && row.slug === input.categorySlug,
  );
  if (!category) return { ok: false, error: "unknown_category" };

  const createdAt = snap.createdAt ? Date.parse(snap.createdAt) : Number.NaN;
  const { id } = await insertApprovedEntry(ctx.db, {
    entry: {
      username,
      kind,
      categoryId: category.id,
      title: profile.title ?? username,
      description: profile.description ?? "",
      lang: snap.lang,
      verified: profile.verified,
      tgCreatedAt: Number.isNaN(createdAt) ? null : createdAt,
      listedAt: now,
    },
    stats: {
      members: profile.members ?? profile.monthlyUsers,
      online: kind === "group" ? profile.online : null,
      activityTier: snap.activityTier,
      statsWrittenAt: now,
    },
    tagIds,
    now,
  });
  await audit(ctx, input.actor, "entry.list", `entry:${id}`, {
    username,
    category: category.slug,
    tags: slugs,
  });
  await markDirtyAndDispatch(ctx);
  return { ok: true, entryId: id };
}

/**
 * Re-fetches one entry now, like one cron slot for a single entry: cold fields, stats, liveness and
 * the R2 media (avatar, posts, member history). The admin passes its `MEDIA` binding.
 */
export async function refreshEntryNow(
  ctx: CoreContext,
  input: { id: number; actor: Actor; media: MediaBucket },
) {
  const row = await getEntryWithStats(ctx.db, input.id);
  if (!row) return null;
  const { entry } = row;
  const now = ctx.now();
  const snapshot = await fetchEntrySnapshot(entry.username, {
    fetch: ctx.fetch,
    now: new Date(now),
    knownKind: entry.kind,
    needCreatedAt: entry.tgCreatedAt === null,
  });

  const tally = { rowsWritten: 0, r2Writes: 0, subrequests: 0, dirty: false };
  if (snapshot.liveness === "active" && snapshot.profile) {
    await applyActiveSnapshot(
      { db: ctx.db, fetch: ctx.fetch, media: input.media },
      { entry, stats: row.stats, snapshot, now, manual: true },
      tally,
    );
  }
  // A manual refresh is a single observation: record it, but never let it hide an entry on its own.
  const liveness = await recordLivenessResult(ctx.db, entry, {
    liveness: snapshot.liveness,
    now,
    allowHide: false,
  });
  tally.rowsWritten += liveness.rowsWritten;
  if (liveness.transition) tally.dirty = true;

  await audit(ctx, input.actor, "entry.refresh", `entry:${entry.id}`, {
    liveness: snapshot.liveness,
    rowsWritten: tally.rowsWritten,
    r2Writes: tally.r2Writes,
  });
  if (tally.dirty) await markDirtyAndDispatch(ctx);
  return {
    liveness: snapshot.liveness,
    rowsWritten: tally.rowsWritten,
    r2Writes: tally.r2Writes,
    transition: liveness.transition,
  };
}

const entriesTarget = (ids: number[]) => (ids.length === 1 ? `entry:${ids[0]}` : "entries");
