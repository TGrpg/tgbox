import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { toHant } from "@tgbox/hant";

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
