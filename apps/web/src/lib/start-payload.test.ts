import { readFileSync } from "node:fs";
import vm from "node:vm";
import { goTelegramTarget, telegramLinks } from "@tgbox/shared";
import ts from "typescript";
import { expect, test } from "vitest";
import { openInTelegram } from "../components/app/entry-card.tsx";
import { appBrowse } from "./app-data.ts";
import { devSiteData } from "./dev-site-data.ts";
import { openData } from "./open-data.ts";

const sample = devSiteData.entries[0];
if (!sample) throw new Error("missing dev fixture");
const bot = {
  ...sample,
  username: "TestBot",
  kind: "bot" as const,
  startPayload: "botlist",
};

test("actual public export and Mini App browse retain the reviewed payload", () => {
  const data = { ...devSiteData, entries: [bot] };
  expect(openData(data).entries[0]?.startPayload).toBe("botlist");
  const entry = appBrowse(data).entries[0];
  if (!entry) throw new Error("missing browse entry");
  let opened = "";
  openInTelegram(
    {
      openTelegramLink: (url: string) => {
        opened = url;
      },
    } as Parameters<typeof openInTelegram>[0],
    entry,
  );
  expect(opened).toBe("https://t.me/TestBot?start=botlist");
});

test("actual Go client retains payload on native, immediate, every mirror and timed redirect", async () => {
  const source = readFileSync(new URL("../views/GoPage.astro", import.meta.url), "utf8");
  const content = source.split("<script>")[1]?.split("</script>")[0];
  if (!content) throw new Error("missing Go client");
  const script = content.replace(/^import .*;\n/gm, "");
  const js = ts.transpile(script, { target: ts.ScriptTarget.ES2022 });
  const nodes = new Map<
    string,
    {
      href?: string;
      hidden?: boolean;
      dataset: Record<string, string>;
      setAttribute: (key: string, value: string) => void;
      querySelector: () => null;
    }
  >();
  const node = (selector: string, dataset: Record<string, string> = {}) => {
    const item = {
      dataset,
      setAttribute(key: string, value: string) {
        Object.assign(this, { [key]: value });
      },
      querySelector: () => null,
    };
    nodes.set(selector, item);
    return item;
  };
  node("[data-go-app]");
  node("[data-go-now]");
  node("[data-go-actions]");
  node("[data-go-target]");
  const hosts = ["t.me", "telegram.me", "telegram.dog"].map((host) => node(host, { goHost: host }));
  const redirects: string[] = [];
  const timers: (() => void)[] = [];
  const root = {
    dataset: {},
    querySelector: (selector: string) => nodes.get(selector) ?? null,
    querySelectorAll: () => hosts,
  };
  vm.runInNewContext(js, {
    document: { getElementById: () => root },
    matchMedia: () => ({ matches: true }),
    springTransition: () => ({}),
    springs: {},
    goTelegramTarget,
    telegramLinks,
    URLSearchParams,
    location: {
      search: `?${telegramLinks(bot).goQuery}`,
      replace: (url: string) => redirects.push(url),
    },
    fetch: async () => ({ ok: true, json: async () => [] }),
    AbortSignal,
    performance: { now: () => 1 },
    setTimeout: (fn: () => void) => {
      timers.push(fn);
      return 1;
    },
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
  });
  await new Promise((resolve) => setImmediate(resolve));
  expect(nodes.get("[data-go-app]")?.href).toBe("tg://resolve?domain=TestBot&start=botlist");
  expect(nodes.get("[data-go-now]")?.href).toBe("https://t.me/TestBot?start=botlist");
  for (const host of ["t.me", "telegram.me", "telegram.dog"])
    expect(nodes.get(host)?.href).toBe(`https://${host}/TestBot?start=botlist`);
  for (const fn of timers) fn();
  expect(redirects).toEqual(["https://t.me/TestBot?start=botlist"]);
});
