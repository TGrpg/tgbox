#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { buildSiteData, projectedStaticFileCount } from "./build-site-data.ts";

// Cloudflare static assets allow 20,000 files; leave headroom for assets and non-entry pages.
const STATIC_FILE_WARNING = 18_000;

const { values } = parseArgs({
  options: {
    db: { type: "string" },
    out: { type: "string" },
    "media-base-url": { type: "string" },
    "media-dir": { type: "string" },
  },
});

if (!values.db || !values.out) {
  console.error(
    "Usage: snapshot --db <export.sqlite|export.sql> --out <site-data.json> [--media-base-url URL | --media-dir DIR]",
  );
  process.exit(1);
}

const data = await buildSiteData({
  dbPath: values.db,
  mediaBaseUrl: values["media-base-url"],
  mediaDir: values["media-dir"],
  now: new Date(),
});
await writeFile(values.out, JSON.stringify(data));

const { total, channels, groups, bots } = data.stats;
const files = projectedStaticFileCount(data);
console.log(
  `snapshot: ${total} entries (${channels} channels, ${groups} groups, ${bots} bots), ` +
    `${data.categories.length} categories, ${data.tags.length} tags → ${values.out}`,
);
console.log(`snapshot: ~${files} static files projected`);
if (files > STATIC_FILE_WARNING) {
  console.warn(
    `snapshot: WARNING projected static files (${files}) exceed ${STATIC_FILE_WARNING}; the 20,000-file asset limit is near`,
  );
}
