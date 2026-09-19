import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { repoRoot } from "../lib/run.ts";
import { markDirtySql, type SeedRow, seedEntrySql } from "./seed-sql.ts";

function migratedDb() {
  const db = new DatabaseSync(":memory:");
  const dir = path.join(repoRoot, "packages/db/migrations");
  for (const file of readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    db.exec(readFileSync(path.join(dir, file), "utf8"));
  }
  return db;
}

const channel: SeedRow = {
  username: "Solidot",
  kind: "channel",
  category: "news",
  tags: ["daily-news", "science", "not-a-tag"],
  title: "Solidot",
  description: "奇客的资讯，重要的东西",
  lang: "zh",
  verified: false,
  avatarVersion: "abc",
  tgCreatedAt: null,
  members: 47_000,
  online: null,
  activityTier: 4,
};

test("migrations seed the taxonomy idempotently", () => {
  const db = migratedDb();
  const count = (table: string) => db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n;
  assert.equal(count("categories"), 54);
  // Migrations only ever insert: tags retired from the seed list are still seeded here, and are
  // removed from a live database with the admin's deleteTag instead.
  assert.equal(count("tags"), 54);
  const before = db.prepare("SELECT total_changes() AS n").get()?.n;
  const again = readFileSync(
    path.join(repoRoot, "packages/db/migrations/0002_taxonomy.sql"),
    "utf8",
  );
  db.exec(again);
  assert.equal(db.prepare("SELECT total_changes() AS n").get()?.n, before);
});

test("seeding lists an approved entry with stats, tags, search row and dirty flag", () => {
  const db = migratedDb();
  db.exec(seedEntrySql(channel, 1000));
  db.exec(markDirtySql(1000));

  const entry = db.prepare("SELECT * FROM entries").get();
  assert.equal(entry?.username, "solidot");
  assert.equal(entry?.status, "approved");
  assert.equal(entry?.listed_at, 1000);
  assert.equal(db.prepare("SELECT members FROM entry_stats").get()?.members, 47_000);
  const tagSlugs = db
    .prepare("SELECT t.slug FROM entry_tags et JOIN tags t ON t.id = et.tag_id ORDER BY t.slug")
    .all()
    .map((row) => row.slug);
  assert.deepEqual(tagSlugs, ["daily-news", "science"]);
  assert.equal(
    db.prepare("SELECT rowid FROM entries_fts WHERE entries_fts MATCH '\"Science\"'").get()?.rowid,
    entry?.id,
  );
  assert.equal(
    db.prepare("SELECT value FROM site_state WHERE key = 'dirty_since'").get()?.value,
    "1000",
  );
});

test("re-seeding keeps listed_at and the dirty mark, and updates changed fields", () => {
  const db = migratedDb();
  db.exec(seedEntrySql(channel, 1000));
  db.exec(markDirtySql(1000));
  db.exec(seedEntrySql({ ...channel, title: "Solidot 2", members: 48_000 }, 2000));
  db.exec(markDirtySql(2000));

  assert.equal(db.prepare("SELECT count(*) AS n FROM entries").get()?.n, 1);
  const entry = db.prepare("SELECT title, listed_at FROM entries").get();
  assert.deepEqual({ ...entry }, { title: "Solidot 2", listed_at: 1000 });
  assert.equal(db.prepare("SELECT members FROM entry_stats").get()?.members, 48_000);
  assert.equal(db.prepare("SELECT count(*) AS n FROM entries_fts").get()?.n, 1);
  assert.equal(db.prepare("SELECT value FROM site_state").get()?.value, "1000");
});

test("an unknown category inserts nothing", () => {
  const db = migratedDb();
  db.exec(seedEntrySql({ ...channel, category: "nope" }, 1000));
  for (const table of ["entries", "entry_stats", "entry_tags", "entries_fts"]) {
    assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n, 0, table);
  }
});
