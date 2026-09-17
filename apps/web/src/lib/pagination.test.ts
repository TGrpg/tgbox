import { expect, test } from "vitest";
import { pageWindow } from "./pagination.ts";

test.each([
  [1, 1, [1]],
  [1, 5, [1, 2, 3, 4, 5]],
  [1, 20, [1, 2, null, 20]],
  [10, 20, [1, null, 9, 10, 11, null, 20]],
  [20, 20, [1, null, 19, 20]],
  [4, 20, [1, 2, 3, 4, 5, null, 20]],
])("page %d of %d", (current, total, expected) => {
  expect(pageWindow(current, total)).toEqual(expected);
});
