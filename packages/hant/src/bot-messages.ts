import { categories, tags } from "@tgbox/shared";
import { toHant } from "./index.ts";

/**
 * The bot's Traditional dictionary, generated from its Simplified one: the bot runs in a Worker,
 * which can't afford OpenCC at request time, so the conversion is committed as source instead.
 */
export function botHantSource(zhSource: string): string {
  const converted = toHant(zhSource)
    // One public export per dictionary file; the helper types stay module-private here.
    .replace(/^export (type|const) (?!zh = )/gm, "$1 ")
    .replace(/^export const zh = /m, "export const zhHant = ");
  // Seed taxonomy names; a name an admin has since changed in D1 falls back to its Simplified form.
  const names = Object.fromEntries(
    [...categories, ...tags]
      .map((item) => [item.nameZh, toHant(item.nameZh)] as const)
      .filter(([zh, hant]) => zh !== hant)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  return [
    "// Generated from zh.ts by `pnpm --filter @tgbox/hant gen:bot`. Edit zh.ts, then regenerate.",
    converted.trimEnd(),
    "",
    "/** Traditional names of the seed categories and tags, keyed by their Simplified names. */",
    `export const hantNames: Record<string, string> = ${JSON.stringify(names, null, 2)};`,
    "",
  ].join("\n");
}

export const botPaths = {
  zh: new URL("../../../apps/bot/src/bot/i18n/zh.ts", import.meta.url),
  hant: new URL("../../../apps/bot/src/bot/i18n/zh-hant.gen.ts", import.meta.url),
};
