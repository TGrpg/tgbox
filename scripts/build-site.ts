// End-to-end site build: D1 export → snapshot JSON → astro build → Pagefind index.
//   local (default): node scripts/build-site.ts [--persist-to .data/wrangler] [--media-dir .data/media]
//   CI:              node scripts/build-site.ts --remote --media-base-url "$R2_PUBLIC_URL"
import { existsSync } from "node:fs";
import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { repoRoot, run, wrangler } from "./lib/run.ts";

// Only what the snapshot reads. D1 export refuses databases with virtual tables (entries_fts),
// and leaving out submissions/blacklist/orders/credentials/bot_chats keeps private data out of CI
// artifacts. `settings` is whole-table (export can't filter rows); the snapshot reads only `site`.
const SNAPSHOT_TABLES = [
  "entries",
  "entry_stats",
  "entry_tags",
  "categories",
  "tags",
  "settings",
  "promotions",
  "hidden_posts",
];

const { values } = parseArgs({
  options: {
    remote: { type: "boolean", default: false },
    "persist-to": { type: "string", default: ".data/wrangler" },
    "media-dir": { type: "string" },
    "media-base-url": { type: "string", default: process.env.R2_PUBLIC_URL },
    "data-dir": { type: "string", default: ".data" },
  },
});

const dataDir = path.resolve(repoRoot, values["data-dir"]);
const webDir = path.join(repoRoot, "apps/web");
await mkdir(dataDir, { recursive: true });

// 1. Export D1
let dbFile: string;
if (values.remote) {
  dbFile = path.join(dataDir, "tgbox.sql");
  await rm(dbFile, { force: true });
  const tables = SNAPSHOT_TABLES.flatMap((table) => ["--table", table]);
  wrangler([
    "d1",
    "export",
    "tgbox",
    "--remote",
    "--output",
    dbFile,
    ...tables,
    "--skip-confirmation",
  ]);
} else {
  // `wrangler d1 export --local` has no --persist-to, so copy the persisted Miniflare database directly.
  const d1Dir = path.resolve(repoRoot, values["persist-to"], "v3/d1/miniflare-D1DatabaseObject");
  const candidates = existsSync(d1Dir)
    ? (await readdir(d1Dir)).filter(
        (name) => name.endsWith(".sqlite") && name !== "metadata.sqlite",
      )
    : [];
  if (candidates.length !== 1) {
    throw new Error(
      `expected one local D1 database in ${d1Dir}, found ${candidates.length}; run scripts/seed/seed.ts --local first`,
    );
  }
  dbFile = path.join(dataDir, "tgbox.sqlite");
  await rm(dbFile, { force: true });
  const source = new DatabaseSync(path.join(d1Dir, candidates[0] ?? ""), { readOnly: true });
  source.prepare("VACUUM INTO ?").run(dbFile);
  source.close();
  console.log(`copied local D1 → ${path.relative(repoRoot, dbFile)}`);
}

// 2. Snapshot
const siteData = path.join(dataDir, "site-data.json");
const mediaDir = values["media-dir"] ?? (values.remote ? undefined : path.join(dataDir, "media"));
run("node", [
  "packages/snapshot/src/cli.ts",
  "--db",
  dbFile,
  "--out",
  siteData,
  ...(mediaDir ? ["--media-dir", path.resolve(repoRoot, mediaDir)] : []),
  ...(values["media-base-url"] ? ["--media-base-url", values["media-base-url"]] : []),
]);

// 3. Astro build (SITE_URL, PUBLIC_BOT_USERNAME, R2_PUBLIC_URL pass through from the environment)
await rm(path.join(webDir, "dist"), { recursive: true, force: true });
run("pnpm", ["--filter", "@tgbox/web", "exec", "astro", "build"], {
  env: { SITE_DATA_PATH: siteData },
});

// 4. Pagefind → apps/web/dist/pagefind (CI uploads it to R2). Locally also copy it into
// dist/client/pagefind so search works in `wrangler dev` preview without R2.
run("pnpm", ["--filter", "@tgbox/web", "exec", "node", "scripts/pagefind.ts", "dist"], {
  env: values.remote ? {} : { PAGEFIND_LOCAL: "1" },
});

async function countFiles(dir: string, filter: (file: string) => boolean = () => true) {
  if (!existsSync(dir)) return 0;
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries.filter(
    (entry) => entry.isFile() && filter(path.join(entry.parentPath, entry.name)),
  ).length;
}
const client = path.join(webDir, "dist/client");
const isDetail = (file: string) => /[/\\]detail[/\\][^/\\]+[/\\]index\.html$/.test(file);
console.log(
  `build-site: ${await countFiles(client, isDetail)} detail pages (zh + en), ` +
    `${await countFiles(client)} static files in apps/web/dist/client, ` +
    `${await countFiles(path.join(webDir, "dist/pagefind"))} Pagefind files in apps/web/dist/pagefind`,
);
