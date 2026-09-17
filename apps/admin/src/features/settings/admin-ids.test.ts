import { describe, expect, test } from "vitest";
import { addAdminIds, isChatId, normalizeSupportUsername } from "./admin-ids.ts";

describe("addAdminIds", () => {
  test("adds new ids, skipping duplicates and super admins", () => {
    expect(addAdminIds("42, 43 42，900", ["7"], ["900"])).toEqual({
      ids: ["7", "42", "43"],
      invalid: [],
    });
  });

  test("reports tokens that are not user ids", () => {
    expect(addAdminIds("@alice 44", [], [])).toEqual({ ids: ["44"], invalid: ["@alice"] });
  });
});

test.each([
  ["-1001234567890", true],
  ["12345", true],
  ["@group", false],
  ["", false],
])("isChatId(%s) → %s", (value, expected) => {
  expect(isChatId(value)).toBe(expected);
});

test.each([
  ["@tgbox_support", "tgbox_support"],
  ["https://t.me/tgbox_support", "tgbox_support"],
  ["  ", null],
])("normalizeSupportUsername(%s) → %s", (value, expected) => {
  expect(normalizeSupportUsername(value)).toBe(expected);
});
