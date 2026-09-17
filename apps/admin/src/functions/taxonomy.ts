import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import {
  deleteCategory,
  deleteTag,
  reorderCategories,
  upsertCategory,
  upsertTag,
} from "@tgbox/core";
import { listCategoriesWithCounts, listTagsWithCounts } from "@tgbox/db";
import { categoryIcons, EntryKind } from "@tgbox/shared";
import { z } from "zod";
import { queryKeys } from "@/lib/query-keys.ts";
import { adminMiddleware } from "@/server/middleware.ts";

const id = z.number().int().positive();
const names = { slug: z.string().max(40), nameZh: z.string().max(40), nameEn: z.string().max(60) };

const $getTaxonomy = createServerFn({ method: "GET" })
  .middleware([adminMiddleware])
  .handler(async ({ context }) => {
    const [categories, tags] = await Promise.all([
      listCategoriesWithCounts(context.core.db),
      listTagsWithCounts(context.core.db),
    ]);
    return {
      categories: categories.map((row) => ({ ...row.category, entries: row.entries })),
      tags: tags.map((row) => ({ ...row.tag, entries: row.entries })),
      icons: categoryIcons,
    };
  });

export const taxonomyQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.taxonomy,
    queryFn: ({ signal }) => $getTaxonomy({ signal }),
  });

export type Taxonomy = Awaited<ReturnType<typeof $getTaxonomy>>;
export type TaxonomyCategory = Taxonomy["categories"][number];
export type TaxonomyTag = Taxonomy["tags"][number];

export const $upsertCategory = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .inputValidator(
    z.object({ id: id.optional(), kind: EntryKind, icon: z.string().nullable(), ...names }),
  )
  .handler(({ data, context }) =>
    upsertCategory(context.core, { ...data, actor: context.auth.actor }),
  );

export const $deleteCategory = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .inputValidator(z.object({ id }))
  .handler(({ data, context }) =>
    deleteCategory(context.core, { id: data.id, actor: context.auth.actor }),
  );

export const $reorderCategories = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .inputValidator(z.object({ kind: EntryKind, ids: z.array(id).min(1).max(200) }))
  .handler(({ data, context }) =>
    reorderCategories(context.core, { ...data, actor: context.auth.actor }),
  );

export const $upsertTag = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .inputValidator(z.object({ id: id.optional(), ...names }))
  .handler(({ data, context }) => upsertTag(context.core, { ...data, actor: context.auth.actor }));

export const $deleteTag = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .inputValidator(z.object({ id }))
  .handler(({ data, context }) =>
    deleteTag(context.core, { id: data.id, actor: context.auth.actor }),
  );
