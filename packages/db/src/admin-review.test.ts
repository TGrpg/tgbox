import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, test } from "vitest";
import {
  createDb,
  createSubmission,
  dashboardActivity,
  insertApprovedEntry,
  insertAuditLog,
  setEntryStatus,
  syncTaxonomy,
} from "./index.ts";

const db = createDb(env.DB);
const NOW = Date.UTC(2026, 8, 17);

beforeEach(async () => {
  await env.DB.batch(
    ["entries", "entry_stats", "entry_tags", "entries_fts", "submissions", "audit_log"].map(
      (table) => env.DB.prepare(`DELETE FROM ${table}`),
    ),
  );
  await syncTaxonomy(db);
});

async function listed(username: string, now: number) {
  const { id } = await insertApprovedEntry(db, {
    entry: {
      username,
      kind: "channel",
      categoryId: 1,
      title: username,
      description: "",
      listedAt: now,
    },
    stats: { members: 1, online: null, activityTier: null, statsWrittenAt: now },
    tagIds: [],
    now,
  });
  return id;
}

describe("dashboardActivity", () => {
  test("returns the newest submissions, system hides, audit rows and last build trigger", async () => {
    for (let i = 0; i < 7; i++) {
      await createSubmission(db, {
        tgUserId: 1,
        username: `sub_${i}`,
        kind: "channel",
        categoryId: 1,
        tagIds: [],
        createdAt: NOW + i,
      });
    }
    const hidden = [];
    for (let i = 0; i < 3; i++) {
      const id = await listed(`hide_${i}`, NOW);
      await setEntryStatus(db, id, "hidden_by_system", NOW + i);
      hidden.push(id);
    }
    const adminHidden = await listed("admin_hidden", NOW);
    await setEntryStatus(db, adminHidden, "hidden_by_admin", NOW + 10);
    await insertAuditLog(db, {
      actor: "tg:1",
      action: "build.trigger",
      target: null,
      createdAt: NOW,
    });
    for (let i = 0; i < 6; i++) {
      await insertAuditLog(db, {
        actor: "tg:1",
        action: "entry.status",
        target: `entry:${i}`,
        createdAt: NOW + i,
      });
    }

    const activity = await dashboardActivity(db, { limit: 5 });

    expect(activity.submissions.map((row) => row.username)).toEqual([
      "sub_6",
      "sub_5",
      "sub_4",
      "sub_3",
      "sub_2",
    ]);
    expect(activity.systemHides.map((row) => row.id)).toEqual([...hidden].reverse());
    expect(activity.audit.map((row) => row.target)).toEqual([
      "entry:5",
      "entry:4",
      "entry:3",
      "entry:2",
      "entry:1",
    ]);
    expect(activity.lastBuildTriggerAt).toBe(NOW);
  });

  test("is empty on a fresh database", async () => {
    expect(await dashboardActivity(db, { limit: 5 })).toEqual({
      submissions: [],
      systemHides: [],
      audit: [],
      lastBuildTriggerAt: null,
    });
  });
});
