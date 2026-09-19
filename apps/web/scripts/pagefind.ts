/**
 * Builds the Pagefind indexes from the built site.
 *
 *   node scripts/pagefind.ts [distDir=dist]
 *
 * Indexes the zh detail pages (`<dist>/client/detail/<u>/index.html`; en pages would duplicate
 * every result) into `<dist>/pagefind`, and the Traditional copies (`zh-hant/detail/…`) into
 * `<dist>/pagefind/zh-hant`, so a reader typing Traditional characters finds them. Deploy can
 * upload the directory to R2 so the index doesn't count against the static-asset file limit. With
 * `PAGEFIND_LOCAL=1` it also copies it to `<dist>/client/pagefind` so `/pagefind/pagefind.js`
 * works in local preview and e2e tests.
 */
import { cpSync, rmSync } from "node:fs";
import path from "node:path";
import { close, createIndex } from "pagefind";

const dist = path.resolve(process.argv[2] ?? "dist");
const site = path.join(dist, "client");
const outputPath = path.join(dist, "pagefind");
rmSync(outputPath, { recursive: true, force: true });

for (const [glob, output] of [
  ["detail/*/index.html", outputPath],
  ["zh-hant/detail/*/index.html", path.join(outputPath, "zh-hant")],
] as const) {
  const { index, errors } = await createIndex({ forceLanguage: "zh" });
  if (!index) throw new Error(`pagefind: ${errors.join("; ")}`);
  const added = await index.addDirectory({ path: site, glob });
  if (added.errors.length > 0) throw new Error(`pagefind: ${added.errors.join("; ")}`);
  const written = await index.writeFiles({ outputPath: output });
  if (written.errors.length > 0) throw new Error(`pagefind: ${written.errors.join("; ")}`);
  console.log(`pagefind: indexed ${added.page_count} pages → ${output}`);
}
await close();

// Copy rather than writing twice: a second writeFiles() on the same index emits empty files.
if (process.env.PAGEFIND_LOCAL === "1") {
  cpSync(outputPath, path.join(site, "pagefind"), { recursive: true });
  console.log(`pagefind: copied to ${path.join(site, "pagefind")}`);
}
