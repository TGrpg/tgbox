import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { awesomeData } from "./awesome-data.ts";
import { devSiteData } from "./dev-site-data.ts";
import { convertTraditionalPages } from "./hant.ts";

const featured = [
  {
    name: "软件频道",
    url: "https://example.com/软件",
    descZh: "机器人推荐",
    descEn: "Daily updates",
  },
  { name: "Second", url: "https://t.me/second", descZh: "", descEn: "" },
];

test("the awesome data publishes explicit featured curation in order without promotion state", () => {
  const data = awesomeData({ ...devSiteData, featured });
  expect(data.featured).toEqual(featured);
  expect(awesomeData({ ...devSiteData, featured: [] }).featured).toEqual([]);
  expect(data).not.toHaveProperty("promos");
  expect(data.entries.every((entry) => !("promo" in entry))).toBe(true);
});

test("the Traditional export converts featured names and descriptions while preserving URLs", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "featured-hant-"));
  try {
    await mkdir(path.join(dir, "data"));
    const target = path.join(dir, "data/awesome.json");
    await writeFile(target, JSON.stringify(awesomeData({ ...devSiteData, featured })));
    await convertTraditionalPages(dir);
    const data = JSON.parse(await readFile(target, "utf8"));
    expect(data.featured).toEqual([
      { ...featured[0], name: "軟件頻道", descZh: "機器人推薦" },
      featured[1],
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
