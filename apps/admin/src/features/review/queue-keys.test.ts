import { describe, expect, test } from "vitest";
import { activeAfterRemoval, moveActive, reviewShortcut } from "./queue-keys.ts";

const key = (k: string, extra: Partial<Parameters<typeof reviewShortcut>[0]> = {}) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  editable: false,
  ...extra,
});

describe("review shortcuts", () => {
  test("maps A/R/J/K case-insensitively", () => {
    expect(reviewShortcut(key("a"))).toBe("approve");
    expect(reviewShortcut(key("R"))).toBe("reject");
    expect(reviewShortcut(key("j"))).toBe("next");
    expect(reviewShortcut(key("k"))).toBe("prev");
  });

  test("ignores modified keys, typing targets and other keys", () => {
    expect(reviewShortcut(key("a", { metaKey: true }))).toBeNull();
    expect(reviewShortcut(key("r", { ctrlKey: true }))).toBeNull();
    expect(reviewShortcut(key("j", { editable: true }))).toBeNull();
    expect(reviewShortcut(key("x"))).toBeNull();
  });
});

describe("active row", () => {
  test("J/K move within bounds and start at the first row", () => {
    expect(moveActive([1, 2, 3], null, 1)).toBe(1);
    expect(moveActive([1, 2, 3], 1, 1)).toBe(2);
    expect(moveActive([1, 2, 3], 3, 1)).toBe(3);
    expect(moveActive([1, 2, 3], 1, -1)).toBe(1);
    expect(moveActive([], null, 1)).toBeNull();
  });

  test("after removal the next remaining row becomes active, else the previous one", () => {
    expect(activeAfterRemoval([1, 2, 3, 4], [2], 2)).toBe(3);
    expect(activeAfterRemoval([1, 2, 3, 4], [2, 3], 2)).toBe(4);
    expect(activeAfterRemoval([1, 2, 3, 4], [4], 4)).toBe(3);
    expect(activeAfterRemoval([1, 2], [1, 2], 1)).toBeNull();
    expect(activeAfterRemoval([1, 2, 3], [3], 1)).toBe(1);
  });
});
