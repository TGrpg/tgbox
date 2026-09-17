import { type EntryKind, MAX_TAGS } from "@tgbox/shared";

type Category = { id: number; kind: EntryKind };

export type EntryEditError =
  | "unknown_category"
  | "category_kind_mismatch"
  | "unknown_tags"
  | "too_many_tags";

/** Checks a category/tags edit against the taxonomy before it reaches core. */
export function checkEntryEdit(
  input: { kind: EntryKind; categoryId?: number; tagIds?: number[] },
  taxonomy: { categories: Category[]; tags: { id: number }[] },
): EntryEditError | null {
  if (input.categoryId !== undefined) {
    const category = taxonomy.categories.find((row) => row.id === input.categoryId);
    if (!category) return "unknown_category";
    if (category.kind !== input.kind) return "category_kind_mismatch";
  }
  if (input.tagIds !== undefined) {
    const unique = new Set(input.tagIds);
    if (unique.size > MAX_TAGS) return "too_many_tags";
    if ([...unique].some((id) => !taxonomy.tags.some((tag) => tag.id === id)))
      return "unknown_tags";
  }
  return null;
}

export const entryEditErrorText: Record<EntryEditError, string> = {
  unknown_category: "分类不存在",
  category_kind_mismatch: "分类与条目类型不匹配",
  unknown_tags: "包含不存在的标签",
  too_many_tags: `标签最多 ${MAX_TAGS} 个`,
};

type Snapshot = {
  title: string;
  description: string;
  lang: string | null;
  verified: boolean;
  liveness: string;
  status: string;
  members: number | null;
  online: number | null;
  activityTier: number | null;
};

export type FieldChange = {
  field: keyof Snapshot;
  before: Snapshot[keyof Snapshot];
  after: Snapshot[keyof Snapshot];
};

/** Field-level changes made by a "refresh now", for display. */
export function diffSnapshots(before: Snapshot, after: Snapshot): FieldChange[] {
  const fields: (keyof Snapshot)[] = [
    "title",
    "description",
    "lang",
    "verified",
    "liveness",
    "status",
    "members",
    "online",
    "activityTier",
  ];
  return fields
    .filter((field) => before[field] !== after[field])
    .map((field) => ({ field, before: before[field], after: after[field] }));
}
