/**
 * Builds the Pagefind indexes from the built site.
 *
 *   node scripts/pagefind.ts [distDir=dist]
 *
 * Indexes the zh detail pages (`<dist>/client/detail/<u>/index.html`; en pages would duplicate
 * every result) into `<dist>/pagefind`, and the Traditional copies (`zh-hant/detail/…`) into
 * `<dist>/pagefind/zh-hant`, so a reader typing Traditional characters finds them. It also copies
 * the directory to `<dist>/client/pagefind`, so `/pagefind/pagefind.js` is served by the site
 * itself. Set `PAGEFIND_R2=1` to skip that copy and serve the index from R2 instead (see
 * scripts/sync-pagefind.ts and PUBLIC_PAGEFIND_URL).
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
if (process.env.PAGEFIND_R2 !== "1") {
  cpSync(outputPath, path.join(site, "pagefind"), { recursive: true });
  console.log(`pagefind: copied to ${path.join(site, "pagefind")}`);
}
