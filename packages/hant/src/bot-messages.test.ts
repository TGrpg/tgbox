import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { botHantSource, botPaths } from "./bot-messages.ts";

test("the bot's Traditional dictionary is up to date with zh.ts (pnpm --filter @tgbox/hant gen:bot)", () => {
  expect(readFileSync(botPaths.hant, "utf8")).toBe(
    botHantSource(readFileSync(botPaths.zh, "utf8")),
  );
});

test("the generated dictionary exports only the Traditional messages and the name map", () => {
  const source = botHantSource(
    'export type Summary = { title: string };\nexport const utcTime = (ms: number) => "时间";\nexport const zh = {\n  hello: "你好，频道",\n};\n',
  );
  expect(source).toContain(
    'type Summary = { title: string };\nconst utcTime = (ms: number) => "時間";',
  );
  expect(source).toContain('export const zhHant = {\n  hello: "你好，頻道",\n};');
  expect(source).toMatch(
    /export const hantNames: Record<string, string> = \{[^}]*"资讯新闻": "資訊新聞"/,
  );
});
