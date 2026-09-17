import type { EntryKind } from "@tgbox/shared";
import { fetchEntrySnapshot } from "@tgbox/telegram";
import type { Actor, CoreContext } from "./context.ts";
import {
  approveSubmission,
  listApprovedSubmission,
  type RejectReason,
  rejectSubmission,
} from "./submissions.ts";

const PREVIEW_POSTS = 5;

/** Approves and lists each submission in order; handled (non-pending) ones come back `ok: false`. */
export async function approveSubmissions(ctx: CoreContext, input: { ids: number[]; actor: Actor }) {
  const results: (
    | { id: number; ok: true; entryId: number | undefined }
    | { id: number; ok: false }
  )[] = [];
  for (const id of input.ids) {
    const approved = await approveSubmission(ctx, { id, actor: input.actor });
    if (!approved) {
      results.push({ id, ok: false });
      continue;
    }
    const { entryId } = await listApprovedSubmission(ctx, approved);
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
