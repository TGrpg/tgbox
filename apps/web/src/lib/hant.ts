import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { toHant } from "@tgbox/hant";

// Absolute URLs keep their exact bytes wherever they appear — href/src, a CSS `url()` in a style
// attribute, JSON-LD or island props: a converted character in a URL is a different URL. One that
// opens a quoted value (raw or HTML-escaped quote, or `(`) runs to the closing delimiter, non-ASCII
// path included. A bare one in prose stops at its last ASCII character, since descriptions run text
// straight on after a link ("从https://github.com/trending获取…"). Site paths are converted with the
// page, so a `/?q=…` search link matches the Traditional index.
const ABSOLUTE_URL =
  /(?<=["'(]|&quot;|&#3[49];)(?:https?:)?\/\/(?:(?!&quot;|&#3[49];)[^\s"'<>()\\])+|(?:https?:)?\/\/[!#-&*-;=?-[\]-~]+/g;

/** A rendered zh page in Traditional Chinese, leaving absolute URLs untouched. */
export function toTraditionalPage(html: string): string {
  let out = "";
  let last = 0;
  for (const match of html.matchAll(ABSOLUTE_URL)) {
    out += toHant(html.slice(last, match.index)) + match[0];
    last = match.index + match[0].length;
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
    const source = await readFile(target, "utf8");
    const converted = file.endsWith(".json")
      ? JSON.stringify(
          JSON.parse(source, (_key, value: unknown) =>
            typeof value === "string" && !/^(?:https?:)?\/\//.test(value) ? toHant(value) : value,
          ),
        )
      : toTraditionalPage(source);
    await writeFile(target, converted);
  }
  return files.length;
}
