import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Converter } from "opencc-js";

// Character forms only ("cn" → "tw" standard glyphs, no Taiwan-specific vocabulary), so the text
// reads naturally in Taiwan and Hong Kong alike. Build-time only: the dictionaries are ~1 MB.
const convert = Converter({ from: "cn", to: "tw" });

// OpenCC misreads these phrases in the site's own copy ("一个中英双语" → 箇中, "并发送" → 併發, …).
const fixes: [wrong: string, right: string][] = [
  ["一箇中", "一個中"],
  ["併發送", "並發送"],
  ["併發言", "並發言"],
  ["併購買", "並購買"],
  ["是隻", "是只"],
];

function toHant(text: string): string {
  let out = convert(text);
  for (const [wrong, right] of fixes) out = out.replaceAll(wrong, right);
  return out;
}

// Links to other sites keep their exact bytes: a converted character in a URL is a different URL.
// Site paths are converted with the page, so a `/?q=…` search link matches the Traditional index.
const EXTERNAL_URL_ATTR = /(\s(?:href|src)=")((?!\/(?!\/))[^"]*)(")/g;

/** A rendered zh page in Traditional Chinese, leaving external URLs untouched. */
export function toTraditionalPage(html: string): string {
  let out = "";
  let last = 0;
  for (const match of html.matchAll(EXTERNAL_URL_ATTR)) {
    const valueStart = match.index + (match[1]?.length ?? 0);
    out += toHant(html.slice(last, valueStart)) + (match[2] ?? "");
    last = valueStart + (match[2]?.length ?? 0);
  }
  return out + toHant(html.slice(last));
}

/** Converts every HTML page and JSON file under `dir` in place; returns how many there were. */
export async function convertTraditionalPages(dir: string): Promise<number> {
  const files = (await readdir(dir, { recursive: true })).filter((file) =>
    /\.(html|json)$/.test(file),
  );
  for (const file of files) {
    const target = path.join(dir, file);
    await writeFile(target, toTraditionalPage(await readFile(target, "utf8")));
  }
  return files.length;
}
