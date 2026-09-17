/**
 * Builds the Pagefind index from the built site.
 *
 *   node scripts/pagefind.ts [distDir=dist]
 *
 * Indexes only zh detail pages (`<dist>/client/detail/<u>/index.html`; en pages would duplicate
 * every result) into `<dist>/pagefind`, which deploy uploads to R2 so the index doesn't count
 * against the static-asset file limit. With `PAGEFIND_LOCAL=1` it also writes the index to
 * `<dist>/client/pagefind` so `/pagefind/pagefind.js` works in local preview and e2e tests.
 */
import { cpSync, rmSync } from "node:fs";
import path from "node:path";
import { close, createIndex } from "pagefind";

const dist = path.resolve(process.argv[2] ?? "dist");
const site = path.join(dist, "client");

const { index, errors } = await createIndex({ forceLanguage: "zh" });
if (!index) throw new Error(`pagefind: ${errors.join("; ")}`);

const added = await index.addDirectory({ path: site, glob: "detail/*/index.html" });
if (added.errors.length > 0) throw new Error(`pagefind: ${added.errors.join("; ")}`);

const outputPath = path.join(dist, "pagefind");
rmSync(outputPath, { recursive: true, force: true });
const written = await index.writeFiles({ outputPath });
if (written.errors.length > 0) throw new Error(`pagefind: ${written.errors.join("; ")}`);
await close();
console.log(`pagefind: indexed ${added.page_count} pages → ${outputPath}`);

// Copy rather than writing twice: a second writeFiles() on the same index emits empty files.
if (process.env.PAGEFIND_LOCAL === "1") {
  cpSync(outputPath, path.join(site, "pagefind"), { recursive: true });
  console.log(`pagefind: copied to ${path.join(site, "pagefind")}`);
}
