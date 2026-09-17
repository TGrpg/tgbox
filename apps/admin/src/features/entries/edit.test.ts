import { describe, expect, test } from "vitest";
import { checkEntryEdit, diffSnapshots } from "./edit.ts";

const taxonomy = {
  categories: [
    { id: 1, kind: "channel" as const },
    { id: 2, kind: "group" as const },
  ],
  tags: [1, 2, 3, 4, 5, 6].map((id) => ({ id })),
};

describe("checkEntryEdit", () => {
  test.each([
    [{ kind: "channel" as const, categoryId: 1, tagIds: [1, 2] }, null],
    [{ kind: "channel" as const }, null],
    [{ kind: "channel" as const, categoryId: 9 }, "unknown_category"],
    [{ kind: "channel" as const, categoryId: 2 }, "category_kind_mismatch"],
    [{ kind: "group" as const, tagIds: [1, 99] }, "unknown_tags"],
    [{ kind: "group" as const, tagIds: [1, 2, 3, 4, 5, 6] }, "too_many_tags"],
    [{ kind: "group" as const, tagIds: [1, 1, 1, 2, 3, 4] }, null],
  ])("%o → %s", (input, expected) => {
    expect(checkEntryEdit(input, taxonomy)).toBe(expected);
  });
});

test("diffSnapshots lists only changed fields", () => {
  const before = {
    title: "Old",
    description: "",
    lang: null,
    verified: false,
    liveness: "active",
    status: "approved",
    members: 10,
    online: null,
    activityTier: 2,
  };
  expect(diffSnapshots(before, { ...before })).toEqual([]);
  expect(diffSnapshots(before, { ...before, title: "New", members: 12 })).toEqual([
    { field: "title", before: "Old", after: "New" },
    { field: "members", before: 10, after: 12 },
  ]);
});
