import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { toHant } from "@tgbox/hant";

/*
 * Absolute URLs keep their exact bytes: a converted character in a URL is a different URL. Where a
 * URL ends depends on where it sits, so each context gets its own rule:
 *
 * - URL attributes (href, src…) are kept whole when absolute, non-ASCII path included; site paths
 *   are converted with the page, so a `/?q=…` search link matches the Traditional index.
 * - srcset is kept as is; CSS keeps everything inside `url(…)`.
 * - JSON (JSON-LD, Astro island props, the data files) is parsed: strings under URL keys are kept
 *   whole when absolute, every other string is text. A description that starts with a link is
 *   still a description.
 * - Inline scripts keep a URL that opens a string literal up to its closing quote.
 * - Text anywhere else keeps a bare URL up to its last ASCII character, since descriptions run
 *   straight on after a link ("从https://github.com/trending获取…").
 */

const BARE_URL = /(?:https?:)?\/\/[!#-&*-;=?-[\]-~]+/g;
const ABSOLUTE = /^\s*(?:https?:)?\/\//;
const URL_ATTRIBUTE =
  /^(?:href|src|action|formaction|poster|cite|background|xlink:href|data-(?:src|href|url))$/i;
const URL_KEY = /(?:url|href|src|image|logo|icon|sameAs|@id|item|target|urlTemplate|site)$/i;

/** Prose: bare URLs keep their ASCII bytes, everything around them is converted. */
function convertText(text: string): string {
  let out = "";
  let last = 0;
  for (const match of text.matchAll(BARE_URL)) {
    out += toHant(text.slice(last, match.index)) + match[0];
    last = match.index + match[0].length;
  }
  return out + toHant(text.slice(last));
}

/** `text` with the matches of `keep` left alone and the rest run through `convertText`. */
function convertAround(text: string, keep: RegExp): string {
  let out = "";
  let last = 0;
  for (const match of text.matchAll(keep)) {
    out += convertText(text.slice(last, match.index)) + match[0];
    last = match.index + match[0].length;
  }
  return out + convertText(text.slice(last));
}

const convertCss = (css: string) => convertAround(css, /url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\s*\)/gi);

const convertScript = (js: string) => convertAround(js, /(?<=["'`])(?:https?:)?\/\/[^"'`\s\\<>]+/g);

/** Strings under URL keys stay whole when absolute; arrays pass their key on to their items. */
function convertJsonValue(value: unknown, key: string): unknown {
  if (typeof value === "string") {
    return URL_KEY.test(key) && ABSOLUTE.test(value) ? value : convertText(value);
  }
  if (Array.isArray(value)) return value.map((item) => convertJsonValue(item, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [name, convertJsonValue(item, name)]),
    );
  }
  return value;
}

/** Converted JSON, or null when `text` isn't JSON. */
function convertJson(text: string): string | null {
  try {
    return JSON.stringify(convertJsonValue(JSON.parse(text), ""));
  } catch {
    return null;
  }
}

const decodeEntities = (text: string) =>
  text.replace(/&(?:#(\d+)|#x([\da-f]+)|(quot|amp|lt|gt|apos));/gi, (entity, dec, hex, name) => {
    if (dec) return String.fromCodePoint(Number(dec));
    if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
    return (
      { quot: '"', amp: "&", lt: "<", gt: ">", apos: "'" }[String(name).toLowerCase()] ?? entity
    );
  });

const escapeAttribute = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );

function convertAttribute(name: string, value: string): string {
  if (URL_ATTRIBUTE.test(name)) return ABSOLUTE.test(value) ? value : convertText(value);
  if (/^(?:srcset|imagesrcset)$/i.test(name)) return value;
  if (/^style$/i.test(name)) return convertCss(value);
  // Astro island props: HTML-escaped JSON.
  if (/^props$/i.test(name)) {
    const json = convertJson(decodeEntities(value));
    if (json !== null) return escapeAttribute(json);
  }
  return convertText(value);
}

const ATTRIBUTE = /(\s[^\s=/>"']+\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/g;

const convertTag = (tag: string) =>
  tag.replace(ATTRIBUTE, (_all, head: string, double?: string, single?: string, bare?: string) => {
    const name = head.trim().replace(/\s*=$/, "").trim();
    if (double !== undefined) return `${head}"${convertAttribute(name, double)}"`;
    if (single !== undefined) return `${head}'${convertAttribute(name, single)}'`;
    return `${head}${convertAttribute(name, bare ?? "")}`;
  });

const REGION =
  /<script\b([^>]*)>([\s\S]*?)<\/script>|<style\b([^>]*)>([\s\S]*?)<\/style>|<!--[\s\S]*?-->|<[a-zA-Z][^>]*>/gi;

/** A rendered zh page in Traditional Chinese, leaving absolute URLs untouched. */
export function toTraditionalPage(html: string): string {
  let out = "";
  let last = 0;
  for (const match of html.matchAll(REGION)) {
    out += convertText(html.slice(last, match.index));
    const [all, scriptAttrs, scriptBody, styleAttrs, styleBody] = match;
    if (scriptAttrs !== undefined) {
      const body = scriptBody ?? "";
      // `<` escaped, so no string in the data can close the script element.
      const json = /type\s*=\s*["']?application\/ld\+json/i.test(scriptAttrs)
        ? convertJson(body)?.replaceAll("<", "\\u003c")
        : undefined;
      const converted = json ?? convertScript(body);
      out += `${convertTag(`<script${scriptAttrs}>`)}${converted}</script>`;
    } else if (styleAttrs !== undefined) {
      out += `${convertTag(`<style${styleAttrs}>`)}${convertCss(styleBody ?? "")}</style>`;
    } else if (all.startsWith("<!--")) {
      out += convertText(all);
    } else {
      out += convertTag(all);
    }
    last = match.index + all.length;
  }
  return out + convertText(html.slice(last));
}

/** Converts every HTML page and JSON file under `dir` in place; returns how many there were. */
export async function convertTraditionalPages(dir: string): Promise<number> {
  const files = (await readdir(dir, { recursive: true })).filter((file) =>
    /\.(html|json)$/.test(file),
  );
  for (const file of files) {
    const target = path.join(dir, file);
    const source = await readFile(target, "utf8");
    const converted = file.endsWith(".json")
      ? (convertJson(source) ?? source)
      : toTraditionalPage(source);
    await writeFile(target, converted);
  }
  return files.length;
}
