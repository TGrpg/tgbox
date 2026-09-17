import {
  categorySlugTaken,
  deleteTag as deleteTagRows,
  deleteUnusedCategory,
  getCategory,
  getTag,
  insertCategory,
  insertTag,
  reorderCategories as reorderCategoryRows,
  tagSlugTaken,
  updateCategory,
  updateTag,
} from "@tgbox/db";
import { categoryIcons, type EntryKind } from "@tgbox/shared";
import { audit } from "./audit.ts";
import { markDirtyAndDispatch } from "./build.ts";
import type { Actor, CoreContext } from "./context.ts";

// D1 is the source of truth for categories and tags; @tgbox/shared only seeds a fresh database.
// Every change is visible on the static site (names, order, icons, tag pages), so it marks dirty.

export type TaxonomyError = "invalid" | "slug_taken" | "not_found" | "in_use";
type Result<T> = ({ ok: true } & T) | { ok: false; error: TaxonomyError };

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function clean<T extends { slug: string; nameZh: string; nameEn: string }>(input: T) {
  const fields = {
    ...input,
    slug: input.slug.trim().toLowerCase(),
    nameZh: input.nameZh.trim(),
    nameEn: input.nameEn.trim(),
  };
  const valid =
    slugPattern.test(fields.slug) &&
    fields.slug.length <= 40 &&
    fields.nameZh.length > 0 &&
    fields.nameZh.length <= 40 &&
    fields.nameEn.length > 0 &&
    fields.nameEn.length <= 60;
  return valid ? fields : null;
}

/** Creates a category (appended to its kind) when `id` is omitted, else edits it. Kind is fixed. */
export async function upsertCategory(
  ctx: CoreContext,
  input: {
    id?: number;
    kind: EntryKind;
    slug: string;
    nameZh: string;
    nameEn: string;
    /** One of `categoryIcons`, or null. */
    icon: string | null;
    actor: Actor;
  },
): Promise<Result<{ id: number; changed: boolean }>> {
  const fields = clean(input);
  const iconValid = input.icon === null || categoryIcons.some((key) => key === input.icon);
  if (!fields || !iconValid) return { ok: false, error: "invalid" };
  const values = {
    slug: fields.slug,
    nameZh: fields.nameZh,
    nameEn: fields.nameEn,
    icon: input.icon,
  };

  if (input.id === undefined) {
    const created = await insertCategory(ctx.db, { ...values, kind: input.kind });
    if (!created) return { ok: false, error: "slug_taken" };
    await audit(ctx, input.actor, "category.create", `category:${created.id}`, {
      kind: input.kind,
      ...values,
    });
    await markDirtyAndDispatch(ctx);
    return { ok: true, id: created.id, changed: true };
  }

  const current = await getCategory(ctx.db, input.id);
  if (!current) return { ok: false, error: "not_found" };
  if (await categorySlugTaken(ctx.db, current.kind, values.slug, current.id)) {
    return { ok: false, error: "slug_taken" };
  }
  const changed = await updateCategory(ctx.db, current.id, values);
  if (changed) {
    await audit(ctx, input.actor, "category.update", `category:${current.id}`, {
      before: {
        slug: current.slug,
        nameZh: current.nameZh,
        nameEn: current.nameEn,
        icon: current.icon,
      },
      after: values,
    });
    await markDirtyAndDispatch(ctx);
  }
  return { ok: true, id: current.id, changed };
}

/** Only categories without entries (any status) or pending submissions can be deleted. */
export async function deleteCategory(
  ctx: CoreContext,
  input: { id: number; actor: Actor },
): Promise<Result<object>> {
  const current = await getCategory(ctx.db, input.id);
  if (!current) return { ok: false, error: "not_found" };
  const outcome = await deleteUnusedCategory(ctx.db, input.id);
  if (outcome !== "deleted") return { ok: false, error: outcome };
  await audit(ctx, input.actor, "category.delete", `category:${current.id}`, {
    kind: current.kind,
    slug: current.slug,
  });
  await markDirtyAndDispatch(ctx);
  return { ok: true };
}

/** Sets the display order of one kind's categories (`ids` in order). Returns rows changed. */
export async function reorderCategories(
  ctx: CoreContext,
  input: { kind: EntryKind; ids: number[]; actor: Actor },
) {
  const ids = [...new Set(input.ids)];
  const { rowsWritten } = await reorderCategoryRows(ctx.db, input.kind, ids);
  if (rowsWritten > 0) {
    await audit(ctx, input.actor, "category.reorder", `categories:${input.kind}`, { ids });
    await markDirtyAndDispatch(ctx);
  }
  return { changed: rowsWritten };
}

/** Creates a tag when `id` is omitted, else edits it. */
export async function upsertTag(
  ctx: CoreContext,
  input: { id?: number; slug: string; nameZh: string; nameEn: string; actor: Actor },
): Promise<Result<{ id: number; changed: boolean }>> {
  const fields = clean(input);
  if (!fields) return { ok: false, error: "invalid" };
  const values = { slug: fields.slug, nameZh: fields.nameZh, nameEn: fields.nameEn };

  if (input.id === undefined) {
    const created = await insertTag(ctx.db, values);
    if (!created) return { ok: false, error: "slug_taken" };
    await audit(ctx, input.actor, "tag.create", `tag:${created.id}`, values);
    await markDirtyAndDispatch(ctx);
    return { ok: true, id: created.id, changed: true };
  }

  const current = await getTag(ctx.db, input.id);
  if (!current) return { ok: false, error: "not_found" };
  if (await tagSlugTaken(ctx.db, values.slug, current.id))
    return { ok: false, error: "slug_taken" };
  const changed = await updateTag(ctx.db, current.id, values);
  if (changed) {
    await audit(ctx, input.actor, "tag.update", `tag:${current.id}`, {
      before: { slug: current.slug, nameZh: current.nameZh, nameEn: current.nameEn },
      after: values,
    });
    await markDirtyAndDispatch(ctx);
  }
  return { ok: true, id: current.id, changed };
}

/** Deletes a tag and removes it from every entry. */
export async function deleteTag(
  ctx: CoreContext,
  input: { id: number; actor: Actor },
): Promise<Result<{ affectedEntries: number }>> {
  const current = await getTag(ctx.db, input.id);
  if (!current) return { ok: false, error: "not_found" };
  const { affectedEntries } = await deleteTagRows(ctx.db, input.id, ctx.now());
  await audit(ctx, input.actor, "tag.delete", `tag:${current.id}`, {
    slug: current.slug,
    entries: affectedEntries,
  });
  await markDirtyAndDispatch(ctx);
  return { ok: true, affectedEntries: affectedEntries.length };
}
