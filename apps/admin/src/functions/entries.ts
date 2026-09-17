import { env } from "cloudflare:workers";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import {
  refreshEntryNow,
  setEntriesStatus,
  setEntryCategoryAndTags,
  setPromoted,
} from "@tgbox/core";
import {
  type Entry,
  type EntryStats,
  getEntryTagIds,
  getEntryWithStats,
  listActivePromotions,
  listCategories,
  listEntriesAdmin,
  listTagIdsForEntries,
  listTags,
} from "@tgbox/db";
import { EntryStatus } from "@tgbox/shared";
import { z } from "zod";
import { checkEntryEdit, diffSnapshots } from "@/features/entries/edit.ts";
import {
  ENTRIES_PAGE_SIZE,
  type EntriesSearch,
  entriesSearchSchema,
} from "@/features/entries/search.ts";
import { queryKeys } from "@/lib/query-keys.ts";
import { adminMiddleware } from "@/server/middleware.ts";

const ids = z.array(z.number().int().positive()).min(1).max(100);

const avatarUrl = (entry: Entry) =>
  entry.avatarVersion === null
    ? null
    : `${env.R2_PUBLIC_URL}/avatars/${entry.username}.jpg?v=${encodeURIComponent(entry.avatarVersion)}`;

export const $listEntries = createServerFn({ method: "GET" })
  .middleware([adminMiddleware])
  .inputValidator(entriesSearchSchema)
  .handler(async ({ data, context }) => {
    const { db } = context.core;
    const { rows, total } = await listEntriesAdmin(db, {
      page: data.page ?? 1,
      pageSize: ENTRIES_PAGE_SIZE,
      kind: data.kind,
      categoryId: data.category,
      status: data.status,
      liveness: data.liveness,
      lang: data.lang,
      promoted: data.promoted,
      q: data.q,
      sort: data.sort,
    });
    const tags = await listTagIdsForEntries(
      db,
      rows.map((row) => row.entry.id),
    );
    // A live paid pin re-asserts `isPromoted` at every site build, so the raw column alone would
    // let an admin "turn promotion off", watch it come back, and have no idea why. `promotions`
    // only holds what is currently running and is deleted on expiry, so this scan is a few rows.
    const pinned = new Set(
      (await listActivePromotions(db, Date.now(), "pin")).flatMap((promotion) =>
        promotion.entryUsername === null ? [] : [promotion.entryUsername],
      ),
    );
    return {
      total,
      siteUrl: env.SITE_URL,
      rows: rows.map(({ entry, stats }) => ({
        id: entry.id,
        username: entry.username,
        kind: entry.kind,
        title: entry.title,
        verified: entry.verified,
        lang: entry.lang,
        categoryId: entry.categoryId,
        tagIds: tags.get(entry.id) ?? [],
        members: stats?.members ?? null,
        activityTier: stats?.activityTier ?? null,
        liveness: entry.liveness,
        status: entry.status,
        promoted: entry.isPromoted,
        /** Pinned by a paid promotion: the site shows the badge regardless of `promoted`. */
        pinnedByPromotion: pinned.has(entry.username),
        hidePosts: entry.hidePosts,
        listedAt: entry.listedAt,
        updatedAt: entry.updatedAt,
        avatarUrl: avatarUrl(entry),
      })),
    };
  });
export type EntryRow = Awaited<ReturnType<typeof $listEntries>>["rows"][number];

export const entriesQueryOptions = (search: EntriesSearch) =>
  queryOptions({
    queryKey: [...queryKeys.entries, search],
    queryFn: ({ signal }) => $listEntries({ data: search, signal }),
    placeholderData: keepPreviousData,
  });

export const $setEntriesStatus = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .inputValidator(z.object({ ids, status: EntryStatus }))
  .handler(({ data, context }) =>
    setEntriesStatus(context.core, {
      ids: data.ids,
      status: data.status,
      actor: context.auth.actor,
    }),
  );

export const $setEntriesPromoted = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .inputValidator(z.object({ ids, promoted: z.boolean() }))
  .handler(({ data, context }) =>
    setPromoted(context.core, {
      ids: data.ids,
      promoted: data.promoted,
      actor: context.auth.actor,
    }),
  );

/** Bulk category change. Entries of another kind than the category are skipped. */
export const $setEntriesCategory = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .inputValidator(z.object({ ids, categoryId: z.number().int().positive() }))
  .handler(async ({ data, context }) => {
    const { db } = context.core;
    const categories = await listCategories(db);
    const changed: number[] = [];
    const skipped: number[] = [];
    for (const id of new Set(data.ids)) {
      const row = await getEntryWithStats(db, id);
      if (
        !row ||
        checkEntryEdit(
          { kind: row.entry.kind, categoryId: data.categoryId },
          { categories, tags: [] },
        )
      ) {
        skipped.push(id);
        continue;
      }
      const result = await setEntryCategoryAndTags(context.core, {
        id,
        categoryId: data.categoryId,
        actor: context.auth.actor,
      });
      if (result.categoryChanged) changed.push(id);
    }
    return { changed, skipped };
  });

export const $getEntryTags = createServerFn({ method: "GET" })
  .middleware([adminMiddleware])
  .inputValidator(z.object({ id: z.number().int().positive() }))
  .handler(({ data, context }) => getEntryTagIds(context.core.db, data.id));

export const $editEntry = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .inputValidator(
    z.object({
      id: z.number().int().positive(),
      categoryId: z.number().int().positive(),
      tagIds: z.array(z.number().int().positive()).max(20),
      promoted: z.boolean(),
    }),
  )
  .handler(async ({ data, context }) => {
    const { db } = context.core;
    const [row, categories, tags] = await Promise.all([
      getEntryWithStats(db, data.id),
      listCategories(db),
      listTags(db),
    ]);
    if (!row) return { ok: false as const, error: "not_found" as const };
    const error = checkEntryEdit(
      { kind: row.entry.kind, categoryId: data.categoryId, tagIds: data.tagIds },
      { categories, tags },
    );
    if (error) return { ok: false as const, error };
    const actor = context.auth.actor;
    const taxonomy = await setEntryCategoryAndTags(context.core, {
      id: data.id,
      categoryId: data.categoryId,
      tagIds: [...new Set(data.tagIds)],
      actor,
    });
    const promoted = await setPromoted(context.core, {
      ids: [data.id],
      promoted: data.promoted,
      actor,
    });
    return { ok: true as const, ...taxonomy, promotedChanged: promoted.changed.length > 0 };
  });

const snapshotOf = ({ entry, stats }: { entry: Entry; stats: EntryStats | null }) => ({
  title: entry.title,
  description: entry.description,
  lang: entry.lang,
  verified: entry.verified,
  liveness: entry.liveness,
  status: entry.status,
  members: stats?.members ?? null,
  online: stats?.online ?? null,
  activityTier: stats?.activityTier ?? null,
});

export const $refreshEntry = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .inputValidator(z.object({ id: z.number().int().positive() }))
  .handler(async ({ data, context }) => {
    const { db } = context.core;
    const before = await getEntryWithStats(db, data.id);
    const result = await refreshEntryNow(context.core, {
      id: data.id,
      actor: context.auth.actor,
      media: env.MEDIA,
    });
    const after = await getEntryWithStats(db, data.id);
    if (!before || !after || !result) return null;
    return { ...result, changes: diffSnapshots(snapshotOf(before), snapshotOf(after)) };
  });
