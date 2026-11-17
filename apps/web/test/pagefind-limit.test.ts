import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, expect, test } from "vitest";

// The Astro build checks its own output against Workers' 20,000 static files, but the Pagefind
// index is copied in afterwards. A site just under the limit must still fail here, before deploy.
const script = path.resolve(import.meta.dirname, "../scripts/pagefind.ts");
const dist = mkdtempSync(path.join(tmpdir(), "tgbox-pagefind-limit-"));
afterAll(() => rmSync(dist, { recursive: true, force: true }));

const page = (title: string) =>
  `<!doctype html><html lang="zh"><head><title>${title}</title></head><body><main data-pagefind-body><h1>${title}</h1><p>${title} 的简介</p></main></body></html>`;

function site(fillers: number) {
  const client = path.join(dist, "client");
  rmSync(dist, { recursive: true, force: true });
  for (const dir of ["detail/one", "zh-hant/detail/one", "filler"]) {
    mkdirSync(path.join(client, dir), { recursive: true });
  }
  writeFileSync(path.join(client, "detail/one/index.html"), page("频道一"));
  writeFileSync(path.join(client, "zh-hant/detail/one/index.html"), page("頻道一"));
  for (let i = 0; i < fillers; i++) writeFileSync(path.join(client, "filler", `${i}.txt`), "");
}

const run = () =>
  spawnSync(process.execPath, [script, dist], {
    encoding: "utf8",
    env: { ...process.env, PAGEFIND_R2: "" },
  });

test("a site just under the limit fails once the Pagefind index is copied in", () => {
  site(19_997); // 19,999 files with the two detail pages
  const result = run();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("exceed the 20,000-file limit");
}, 120_000);

test("a small site builds its index and passes", () => {
  site(10);
  const result = run();
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
}, 120_000);
