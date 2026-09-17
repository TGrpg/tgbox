import { findPendingSubmission, getBlacklistEntry, getEntryByUsername } from "@tgbox/db";
import { parseTelegramRef } from "@tgbox/shared";
import { fetchEntrySnapshot } from "@tgbox/telegram";
import type { CoreContext } from "./context.ts";

const PREVIEW_POSTS = 3;

/**
 * Admin "add entry" step 1: what would be listed for this username. Read-only (no rows written,
 * no audit). An already listed username is reported without fetching t.me.
 */
export async function previewEntry(ctx: CoreContext, input: { username: string }) {
  const username = parseTelegramRef(input.username)?.toLowerCase();
  if (!username) return { ok: false as const, error: "invalid_username" as const };

  const [entry, pending, blacklisted] = await Promise.all([
    getEntryByUsername(ctx.db, username),
    findPendingSubmission(ctx.db, username),
    getBlacklistEntry(ctx.db, "username", username),
  ]);
  const base = {
    ok: true as const,
    username,
    existing: entry ? { id: entry.id, status: entry.status, title: entry.title } : null,
    pendingSubmissionId: pending?.id ?? null,
    blacklisted: blacklisted !== undefined,
  };
  if (entry) return { ...base, snapshot: null };

  const snap = await fetchEntrySnapshot(username, {
    fetch: ctx.fetch,
    now: new Date(ctx.now()),
    knownKind: null,
    needCreatedAt: false,
  });
  const profile = snap.profile;
  return {
    ...base,
    snapshot: {
      liveness: snap.liveness,
      kind: snap.kind,
      title: profile?.title ?? null,
      description: profile?.description ?? null,
      avatarUrl: profile?.avatarUrl ?? null,
      verified: profile?.verified ?? false,
      members: profile?.members ?? null,
      online: profile?.online ?? null,
      monthlyUsers: profile?.monthlyUsers ?? null,
      lang: snap.lang,
      posts: (snap.posts ?? []).slice(-PREVIEW_POSTS).reverse(),
    },
  };
}
export type EntryPreview = Awaited<ReturnType<typeof previewEntry>>;
