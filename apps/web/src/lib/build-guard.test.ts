import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { checkStaticFileCount, countFiles } from "./build-guard.ts";

test.each([
  [100, "ok"],
  [18_000, "ok"],
  [18_001, "warn"],
  [20_000, "warn"],
  [20_001, "fail"],
])("%d static files → %s", (count, expected) => {
  expect(checkStaticFileCount(count)).toBe(expected);
});

test("countFiles counts files in nested directories", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tgbox-count-"));
  try {
    mkdirSync(path.join(dir, "a/b"), { recursive: true });
    writeFileSync(path.join(dir, "index.html"), "");
    writeFileSync(path.join(dir, "a/b/index.html"), "");
    expect(await countFiles(dir)).toBe(2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
