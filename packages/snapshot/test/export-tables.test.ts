import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const read = (file: string) => readFileSync(path.join(repoRoot, file), "utf8");

/**
 * `scripts/build-site.ts` is a script, not a module — importing it would run a build — so the
 * allowlist is read out of its source.
 */
function exportedTables(): string[] {
  const source = read("scripts/build-site.ts");
  const block = source.match(/const SNAPSHOT_TABLES = \[(.*?)\]/s)?.[1] ?? "";
  return [...block.matchAll(/"([a-z_]+)"/g)].map((match) => match[1] as string);
}

/**
 * The exporter ships an allowlist and the snapshot then reads those tables. Nothing links the two,
 * so adding a `hasTable("x")` read without adding `x` to the allowlist yields an export with no
 * such table: `hasTable` returns false and the feature ships silently empty. That is exactly how
 * the Mini App's price list first went out as `[]`.
 */
test("every table the snapshot reads is one the exporter ships", () => {
  const probed = [
    ...read("packages/snapshot/src/build-site-data.ts").matchAll(/hasTable\("([a-z_]+)"\)/g),
  ].map((match) => match[1] as string);
  expect(probed.length).toBeGreaterThan(0);
  for (const table of new Set(probed)) expect(exportedTables()).toContain(table);
});

/** The allowlist is what keeps buyer ids, secrets and drafts out of a public build artifact. */
test("no private table is ever exported", () => {
  const privateTables = [
    "orders",
    "credentials",
    "submissions",
    "blacklist",
    "bot_chats",
    "user_prefs",
    "support_threads",
    "bot_drafts",
    "usdt_payments",
    "audit_log",
  ];
  for (const table of privateTables) expect(exportedTables()).not.toContain(table);
});
