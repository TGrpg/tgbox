import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, test } from "vitest";
import {
  adminStats,
  createDb,
  createSubmission,
  insertApprovedEntry,
  insertAuditLog,
  listAuditLog,
  listEntriesAdmin,
  listSubmissions,
  markDirty,
  setEntryStatus,
  setSiteState,
  syncTaxonomy,
} from "./index.ts";

const db = createDb(env.DB);
const NOW = Date.UTC(2026, 8, 17);
const DAY = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  await env.DB.batch(
    [
      "entries",
      "entry_stats",
      "entry_tags",
      "entries_fts",
      "submissions",
      "site_state",
      "audit_log",
    ].map((table) => env.DB.prepare(`DELETE FROM ${table}`)),
  );
  await syncTaxonomy(db);
});

async function listed(
  username: string,
  options: { kind?: "channel" | "group" | "bot"; members?: number; title?: string } = {},
) {
  const { id } = await insertApprovedEntry(db, {
    entry: {
      username,
      kind: options.kind ?? "channel",
      categoryId: 1,
      title: options.title ?? username,
      description: "",
      listedAt: NOW,
    },
    stats: {
      members: options.members ?? 10,
      online: null,
      activityTier: null,
      statsWrittenAt: NOW,
    },
    tagIds: [],
    now: NOW,
  });
  return id;
}

describe("audit log", () => {
  test("pages newest first with a cursor", async () => {
    for (const n of [1, 2, 3]) {
      await insertAuditLog(db, {
        actor: "tg:1",
        action: "entry.hide",
        target: `entry:${n}`,
        payload: { n },
        createdAt: NOW + n,
      });
    }
    const first = await listAuditLog(db, { limit: 2 });
    expect(first.rows.map((row) => row.target)).toEqual(["entry:3", "entry:2"]);
    expect(first.rows[0]?.payload).toEqual({ n: 3 });
    const second = await listAuditLog(db, { limit: 2, cursor: first.nextCursor ?? 0 });
    expect(second.rows.map((row) => row.target)).toEqual(["entry:1"]);
    expect(second.nextCursor).toBeNull();
  });
});

describe("admin stats", () => {
  test("counts entries by status and kind, pending submissions, recent system hides and site state", async () => {
    await listed("chan_a");
    await listed("group_a", { kind: "group" });
    const hidden = await listed("chan_hidden");
    await setEntryStatus(db, hidden, "hidden_by_system", NOW - DAY);
    const oldHidden = await listed("chan_old_hidden");
    await setEntryStatus(db, oldHidden, "hidden_by_system", NOW - 10 * DAY);
    await createSubmission(db, {
      tgUserId: 1,
      username: "pending_one",
      kind: "bot",
      categoryId: 1,
      tagIds: [],
      createdAt: NOW,
    });
    await markDirty(db, NOW - 5);
    await setSiteState(db, "last_build_at", String(NOW - 100));

    expect(await adminStats(db, NOW)).toEqual({
      total: 4,
      byStatus: { approved: 2, hidden_by_system: 2, hidden_by_admin: 0, removed: 0 },
      byKind: { channel: 1, group: 1, bot: 0 },
      pendingSubmissions: 1,
      hiddenBySystemLast7d: 1,
      dirtySince: NOW - 5,
      lastBuildAt: NOW - 100,
    });
  });
});

describe("entries list", () => {
  test("filters, searches, sorts and reports the total across pages", async () => {
    await listed("alpha_news", { members: 50, title: "Alpha News" });
    await listed("beta_news", { members: 500, title: "Beta News" });
    await listed("gamma_bot", { kind: "bot", members: 5 });

    const page = await listEntriesAdmin(db, {
      page: 1,
      pageSize: 1,
      q: "NEWS",
      sort: "members_desc",
    });
    expect(page.total).toBe(2);
    expect(page.rows.map((row) => row.entry.username)).toEqual(["beta_news"]);

    const second = await listEntriesAdmin(db, {
      page: 2,
      pageSize: 1,
      q: "news",
      sort: "members_desc",
    });
    expect(second.rows.map((row) => row.entry.username)).toEqual(["alpha_news"]);

    const bots = await listEntriesAdmin(db, {
      page: 1,
      pageSize: 20,
      kind: "bot",
      promoted: false,
    });
    expect(bots.rows.map((row) => row.entry.username)).toEqual(["gamma_bot"]);
    expect(bots.rows[0]?.stats?.members).toBe(5);
  });

  test("a LIKE wildcard in the query matches literally", async () => {
    await listed("under_score");
    await listed("underxscore");
    const result = await listEntriesAdmin(db, { page: 1, pageSize: 20, q: "r_s" });
    expect(result.rows.map((row) => row.entry.username)).toEqual(["under_score"]);
  });
});

describe("submissions list", () => {
  test("pending submissions come oldest first with a total", async () => {
    for (const username of ["first_sub", "second_sub"]) {
      await createSubmission(db, {
        tgUserId: 1,
        username,
        kind: "channel",
        categoryId: 1,
        tagIds: [],
        createdAt: NOW,
      });
    }
    const result = await listSubmissions(db, { status: "pending", page: 1 });
    expect(result.total).toBe(2);
    expect(result.rows.map((row) => row.username)).toEqual(["first_sub", "second_sub"]);
  });
});
