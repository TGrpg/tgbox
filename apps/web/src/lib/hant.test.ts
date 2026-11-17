import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { convertTraditionalPages, toTraditionalPage } from "./hant.ts";

test("page text, attributes and inline data are converted to Traditional", () => {
  const page = toTraditionalPage(
    '<html lang="zh-Hant"><title>频道导航</title><meta content="机器人与群组">' +
      '<script type="application/ld+json">{"name":"软件发布"}</script><p>这里是后台</p></html>',
  );
  expect(page).toBe(
    '<html lang="zh-Hant"><title>頻道導航</title><meta content="機器人與群組">' +
      '<script type="application/ld+json">{"name":"軟件發佈"}</script><p>這裡是後臺</p></html>',
  );
});

test("external URLs keep their bytes; site paths are converted with the page", () => {
  const page = toTraditionalPage(
    '<a href="https://zh.wikipedia.org/wiki/电报">电报</a>' +
      '<img src="//cdn.example/图.png"><a href="/?q=频道">搜索</a>',
  );
  expect(page).toBe(
    '<a href="https://zh.wikipedia.org/wiki/电报">電報</a>' +
      '<img src="//cdn.example/图.png"><a href="/?q=頻道">搜索</a>',
  );
});

test("absolute URLs outside href/src keep their bytes too", () => {
  const page = toTraditionalPage(
    '<div style="background: url(&quot;https://img.example/软件.png&quot;) center">软件</div>' +
      '<img srcset="https://img.example/图.png 1x, //img.example/a@2x.png 2x">' +
      '<script type="application/ld+json">{"url":"https://img.example/频道","name":"频道"}</script>' +
      '<astro-island props="{&quot;href&quot;:[0,&quot;https://t.me/频道&quot;]}"></astro-island>',
  );
  expect(page).toBe(
    '<div style="background: url(&quot;https://img.example/软件.png&quot;) center">軟件</div>' +
      '<img srcset="https://img.example/图.png 1x, //img.example/a@2x.png 2x">' +
      '<script type="application/ld+json">{"url":"https://img.example/频道","name":"頻道"}</script>' +
      '<astro-island props="{&quot;href&quot;:[0,&quot;https://t.me/频道&quot;]}"></astro-island>',
  );
});

test("a bare link in prose keeps its bytes, the text running on after it is still converted", () => {
  expect(toTraditionalPage("<p>机器人会自动从https://github.com/trending获取新的存储库</p>")).toBe(
    "<p>機器人會自動從https://github.com/trending獲取新的存儲庫</p>",
  );
});

test("every page and JSON file in the tree is converted in place, other files are left alone", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hant-"));
  mkdirSync(path.join(dir, "detail/x"), { recursive: true });
  writeFileSync(path.join(dir, "404.html"), "<p>页面不存在</p>");
  writeFileSync(path.join(dir, "detail/x/index.html"), "<p>简介</p>");
  writeFileSync(path.join(dir, "data.json"), '{"t":"简介"}');
  writeFileSync(path.join(dir, "notes.txt"), "简介");
  expect(await convertTraditionalPages(dir)).toBe(3);
  expect(readFileSync(path.join(dir, "404.html"), "utf8")).toBe("<p>頁面不存在</p>");
  expect(readFileSync(path.join(dir, "detail/x/index.html"), "utf8")).toBe("<p>簡介</p>");
  expect(readFileSync(path.join(dir, "data.json"), "utf8")).toBe('{"t":"簡介"}');
  expect(readFileSync(path.join(dir, "notes.txt"), "utf8")).toBe("简介");
});

test("phrases OpenCC gets wrong in the site's copy are corrected", () => {
  expect(toTraditionalPage("<p>TGbox 是一个中英双语的导航站，私聊机器人并发送 /help</p>")).toBe(
    "<p>TGbox 是一個中英雙語的導航站，私聊機器人並發送 /help</p>",
  );
  expect(toTraditionalPage("<p>代价是只有管理员能发言，任何人都能加入并发言</p>")).toBe(
    "<p>代價是只有管理員能發言，任何人都能加入並發言</p>",
  );
});
