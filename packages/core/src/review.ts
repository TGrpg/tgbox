import { getSubmission, setEntryStatus } from "@tgbox/db";
import type { EntryKind } from "@tgbox/shared";
import { fetchEntrySnapshot } from "@tgbox/telegram";
import type { Actor, CoreContext } from "./context.ts";
import {
  announceListing,
  insertSubmissionEntry,
  markApproved,
  type RejectReason,
  rejectSubmission,
} from "./submissions.ts";

const PREVIEW_POSTS = 5;

/**
 * Lists and approves each submission in order; handled (non-pending) ones come back `ok: false`.
 *
 * The entry is inserted before the submission is marked approved: a request cut short in between
 * leaves the submission pending in the queue with its entry already there, and approving it again
 * finishes the job. The other order left an approved submission with no entry that nothing would
 * ever retry. (A retried approval finds the entry existing, so it skips the channel post.)
 */
export async function approveSubmissions(ctx: CoreContext, input: { ids: number[]; actor: Actor }) {
  const results: (
    | { id: number; ok: true; entryId: number | undefined }
    | { id: number; ok: false }
  )[] = [];
  for (const id of input.ids) {
    const submission = await getSubmission(ctx.db, id);
    if (submission?.status !== "pending") {
      results.push({ id, ok: false });
      continue;
    }
    const { entryId, created } = await insertSubmissionEntry(ctx, submission);
    const approved = await markApproved(ctx, submission, input.actor);
    if (!approved) {
      // Another reviewer handled it while t.me was being fetched. An entry this call created for a
      // submission they rejected must not go live; one they approved is theirs to announce.
      const now = await getSubmission(ctx.db, id);
      if (created && entryId !== undefined && now?.status !== "approved") {
        await setEntryStatus(ctx.db, entryId, "removed", ctx.now());
      }
      results.push({ id, ok: false });
      continue;
    }
    await announceListing(ctx, approved, created);
    results.push({ id, ok: true, entryId });
  }
  return results;
}

/** Rejects each submission with the same reason; handled ones come back `ok: false`. */
export async function rejectSubmissions(
  ctx: CoreContext,
  input: { ids: number[]; reason: RejectReason; actor: Actor },
) {
  const results: { id: number; ok: boolean }[] = [];
  for (const id of input.ids) {
    const rejected = await rejectSubmission(ctx, { id, reason: input.reason, actor: input.actor });
    results.push({ id, ok: rejected !== null });
  }
  return results;
}

/** Live t.me snapshot for the review drawer. Read-only: nothing is stored or audited. */
export async function previewSubmission(
  ctx: CoreContext,
  input: { username: string; kind: EntryKind },
) {
  const snap = await fetchEntrySnapshot(input.username, {
    fetch: ctx.fetch,
    now: new Date(ctx.now()),
    knownKind: input.kind,
    needCreatedAt: false,
  });
  return {
    liveness: snap.liveness,
    kind: snap.kind,
    profile: snap.profile,
    posts: snap.posts?.slice(0, PREVIEW_POSTS) ?? null,
    lang: snap.lang,
    rateLimited: snap.rateLimited,
  };
}
