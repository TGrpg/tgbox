import {
  approveSubmission as approveSubmissionRow,
  getEntryByUsername,
  getSubmission,
  insertApprovedEntry,
  rejectSubmission as rejectSubmissionRow,
  type Submission,
} from "@tgbox/db";
import { fetchEntrySnapshot } from "@tgbox/telegram";
import { audit } from "./audit.ts";
import { markDirtyAndDispatch } from "./build.ts";
import { type Actor, background, type CoreContext } from "./context.ts";
import { publishEntryToChannel } from "./publish.ts";

export const rejectReasons = [
  "content",
  "grey",
  "fake_subs",
  "inactive",
  "duplicate",
  "other",
] as const;
export type RejectReason = (typeof rejectReasons)[number];

const reviewerIdOf = (actor: Actor) => (actor.startsWith("tg:") ? Number(actor.slice(3)) : null);

/**
 * Pending → approved state transition. Returns the submission, or null if it was already handled.
 * The entry is listed by `listApprovedSubmission`, which the bot runs after answering Telegram.
 */
export async function approveSubmission(ctx: CoreContext, input: { id: number; actor: Actor }) {
  const submission = await getSubmission(ctx.db, input.id);
  const now = ctx.now();
  if (
    !submission ||
    !(await approveSubmissionRow(ctx.db, input.id, reviewerIdOf(input.actor), now))
  ) {
    return null;
  }
  await audit(ctx, input.actor, "submission.approve", `submission:${input.id}`, {
    username: submission.username,
  });
  const approved: Submission = {
    ...submission,
    status: "approved",
    reviewerId: reviewerIdOf(input.actor),
    reviewedAt: now,
  };
  return approved;
}

/**
 * Fetches the t.me profile and lists an approved submission; marks the site dirty. A newly created
 * entry is announced in the publish channel in the background (bot and admin approvals alike).
 */
export async function listApprovedSubmission(ctx: CoreContext, submission: Submission) {
  const now = ctx.now();
  const snap = await fetchEntrySnapshot(submission.username, {
    fetch: ctx.fetch,
    now: new Date(now),
    knownKind: submission.kind,
    needCreatedAt: true,
  });
  const profile = snap.liveness === "active" ? snap.profile : null;
  // A leftover entry (e.g. removed earlier) keeps its row; the unique username forbids a second one.
  const existing = await getEntryByUsername(ctx.db, submission.username);
  let entryId = existing?.id;
  if (!existing) {
    const createdAt = snap.createdAt ? Date.parse(snap.createdAt) : Number.NaN;
    ({ id: entryId } = await insertApprovedEntry(ctx.db, {
      entry: {
        username: submission.username,
        kind: submission.kind,
        categoryId: submission.categoryId,
        title: profile?.title ?? submission.fetchedTitle ?? submission.username,
        description: profile?.description ?? submission.fetchedDescription ?? "",
        lang: snap.lang,
        verified: profile?.verified ?? false,
        tgCreatedAt: Number.isNaN(createdAt) ? null : createdAt,
        listedAt: now,
      },
      stats: {
        members: profile ? (profile.members ?? profile.monthlyUsers) : submission.fetchedMembers,
        online: profile?.online ?? null,
        activityTier: snap.activityTier,
        statsWrittenAt: now,
      },
      tagIds: submission.tagIds,
      now,
    }));
  }
  await markDirtyAndDispatch(ctx);
  if (!existing) {
    await background(ctx, () => publishEntryToChannel(ctx, { username: submission.username }));
  }
  return { entryId, created: !existing };
}

/** Pending → rejected. Returns the submission, or null if it was already handled. */
export async function rejectSubmission(
  ctx: CoreContext,
  input: { id: number; reason: RejectReason; actor: Actor },
) {
  const submission = await getSubmission(ctx.db, input.id);
  const now = ctx.now();
  if (
    !submission ||
    !(await rejectSubmissionRow(ctx.db, input.id, reviewerIdOf(input.actor), input.reason, now))
  ) {
    return null;
  }
  await audit(ctx, input.actor, "submission.reject", `submission:${input.id}`, {
    username: submission.username,
    reason: input.reason,
  });
  const rejected: Submission = {
    ...submission,
    status: "rejected",
    rejectReason: input.reason,
    reviewerId: reviewerIdOf(input.actor),
    reviewedAt: now,
  };
  return rejected;
}
