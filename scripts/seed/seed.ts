// Seeds approved entries from seed-list.json: fetches each t.me profile (same fetch as the refresh cron),
// writes D1 rows via `wrangler d1 execute`, stores posts/history/avatars, then marks the site dirty.
//   node scripts/seed/seed.ts --local [--persist-to .data/wrangler] [--media-dir .data/media]
//   node scripts/seed/seed.ts --remote   (also uploads media to R2; run migrations first, see docs/deploy.md)
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  entryKinds,
  findCategory,
  findTag,
  type MemberPoint,
  parseTelegramRef,
} from "../../packages/shared/src/index.ts";
import { fetchEntrySnapshot } from "../../packages/telegram/src/index.ts";
import { repoRoot, wrangler } from "../lib/run.ts";
import { markDirtySql, type SeedRow, seedEntrySql } from "./seed-sql.ts";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const BUCKET = "tgbox-media";

const { values } = parseArgs({
  options: {
    local: { type: "boolean", default: false },
    remote: { type: "boolean", default: false },
    "persist-to": { type: "string", default: ".data/wrangler" },
    "media-dir": { type: "string", default: ".data/media" },
    list: { type: "string", default: path.join(import.meta.dirname, "seed-list.json") },
  },
});
if (values.local === values.remote) {
  console.error("Usage: seed.ts --local [--persist-to DIR] [--media-dir DIR] | --remote");
  process.exit(1);
}
const target = values.remote
  ? ["--remote"]
  : ["--local", "--persist-to", path.resolve(repoRoot, values["persist-to"])];
const mediaDir = path.resolve(repoRoot, values["media-dir"]);

type ListItem = {
  username: string;
  kind: (typeof entryKinds)[number];
  category: string;
  tags: string[];
};

function parseList(raw: unknown): ListItem[] {
  if (!Array.isArray(raw)) throw new Error("seed list must be an array");
  return raw.map((item, index) => {
    const { username, kind, category, tags } = item ?? {};
    const where = `seed list [${index}] ${username}`;
    if (typeof username !== "string" || parseTelegramRef(username) !== username)
      throw new Error(`${where}: bad username`);
    const entryKind = entryKinds.find((k) => k === kind);
    if (!entryKind) throw new Error(`${where}: bad kind ${kind}`);
    if (typeof category !== "string" || !findCategory(entryKind, category))
      throw new Error(`${where}: unknown ${kind} category ${category}`);
    if (!Array.isArray(tags) || !tags.every((tag) => typeof tag === "string" && findTag(tag)))
      throw new Error(`${where}: unknown tag in ${JSON.stringify(tags)}`);
    return { username, kind: entryKind, category, tags };
  });
}

const list = parseList(JSON.parse(await readFile(values.list, "utf8")));
const now = Date.now();
const media: { key: string; file: string; contentType: string }[] = [];

async function saveMedia(key: string, body: string | Uint8Array, contentType: string) {
  const file = path.join(mediaDir, key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, body);
  media.push({ key, file, contentType });
}

async function readHistory(key: string): Promise<MemberPoint[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path.join(mediaDir, key), "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const rows: SeedRow[] = [];
for (const item of list) {
  const username = item.username.toLowerCase();
  const snap = await fetchEntrySnapshot(item.username, {
    fetch,
    now: new Date(now),
    knownKind: item.kind,
    needCreatedAt: true,
  });
  const profile = snap.profile;
  if (snap.liveness !== "active" || !profile || snap.kind !== item.kind) {
    console.warn(`skip @${item.username}: liveness=${snap.liveness} kind=${snap.kind}`);
    if (snap.rateLimited) await new Promise((resolve) => setTimeout(resolve, 10_000));
    continue;
  }

  // Same fingerprint as the refresh cron, so it doesn't re-download every avatar on its first pass.
  let avatarVersion: string | null = null;
  if (profile.avatarUrl) {
    const res = await fetch(profile.avatarUrl).catch(() => null);
    if (res?.ok) {
      await saveMedia(
        `avatars/${username}.jpg`,
        new Uint8Array(await res.arrayBuffer()),
        res.headers.get("content-type") ?? "image/jpeg",
      );
      avatarVersion = createHash("sha256")
        .update(new URL(profile.avatarUrl).pathname)
        .digest("hex")
        .slice(0, 16);
    }
  }
  if (snap.posts) {
    await saveMedia(`posts/${username}.json`, JSON.stringify(snap.posts), "application/json");
  }
  const members = item.kind === "bot" ? profile.monthlyUsers : profile.members;
  if (members !== null) {
    const history = await readHistory(`history/${username}.json`);
    const last = history.at(-1);
    if (!last || now - Date.parse(last.t) >= WEEK_MS) {
      history.push({ t: new Date(now).toISOString(), members });
    }
    await saveMedia(`history/${username}.json`, JSON.stringify(history), "application/json");
  }

  const createdAt = snap.createdAt ? Date.parse(snap.createdAt) : Number.NaN;
  rows.push({
    ...item,
    title: profile.title ?? item.username,
    description: profile.description ?? "",
    lang: snap.lang,
    verified: profile.verified,
    avatarVersion,
    tgCreatedAt: Number.isFinite(createdAt) ? createdAt : null,
    members,
    online: item.kind === "group" ? profile.online : null,
    activityTier: item.kind === "channel" ? snap.activityTier : null,
  });
  console.log(`fetched @${item.username}: ${JSON.stringify(profile.title)} members=${members}`);
}

if (rows.length === 0) throw new Error("nothing fetched; not touching the database");

wrangler(["d1", "migrations", "apply", "tgbox", ...target]);
const sqlFile = path.join(await mkdtemp(path.join(tmpdir(), "tgbox-seed-")), "seed.sql");
await writeFile(
  sqlFile,
  [...rows.map((row) => seedEntrySql(row, now)), markDirtySql(now)].join("\n"),
);
wrangler(["d1", "execute", "tgbox", ...target, "--file", sqlFile, "--yes"], { capture: true });

if (values.remote) {
  for (const item of media) {
    wrangler([
      "r2",
      "object",
      "put",
      `${BUCKET}/${item.key}`,
      "--file",
      item.file,
      "--content-type",
      item.contentType,
      "--remote",
    ]);
  }
}
console.log(
  `seeded ${rows.length}/${list.length} entries, ${media.length} media files → ${path.relative(repoRoot, mediaDir)}` +
    (values.remote ? " (uploaded to R2)" : ""),
);
