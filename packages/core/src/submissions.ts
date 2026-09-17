import {
  approveSubmission as approveSubmissionRow,
  countSubmissionsSince,
  createSubmission,
  findPendingSubmission,
  getBlacklistEntry,
  getEntryByUsername,
  getSubmission,
  insertApprovedEntry,
  listCategories,
  listTags,
  rejectSubmission as rejectSubmissionRow,
  type Submission,
} from "@tgbox/db";
import { entryKinds, MAX_TAGS, parseTelegramRef, type SubmitError } from "@tgbox/shared";
import { fetchEntrySnapshot } from "@tgbox/telegram";
import { audit } from "./audit.ts";
import { markDirtyAndDispatch } from "./build.ts";
import { type Actor, background, type CoreContext } from "./context.ts";
import { publishEntryToChannel } from "./publish.ts";
import { notifyNewSubmission } from "./review-notify.ts";
import { getSettings } from "./settings.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether this user may submit this username right now, in the order a person experiences it:
 * a closed queue first, then the username itself, then their own daily budget. The bot and the
 * Mini App both go through here so the two entry points cannot drift apart; the bot turns the
 * error into its own copy, the Mini App returns it verbatim (`SubmitError` in the API contract).
 *
 * Read-only: nothing is written and no t.me request is made.
 */
export async function checkSubmission(
  ctx: CoreContext,
  input: { tgUserId: number; username: string },
): Promise<{ ok: true; username: string } | { ok: false; error: SubmitError }> {
  const username = parseTelegramRef(input.username);
  if (!username) return { ok: false, error: "invalid" };

  const { bot } = await getSettings(ctx);
  if (!bot.submissionsOpen) return { ok: false, error: "closed" };
  // A blacklisted username is refused for everyone, however it is spelled.
  if (await getBlacklistEntry(ctx.db, "username", username)) return { ok: false, error: "banned" };
  if (await getEntryByUsername(ctx.db, username)) return { ok: false, error: "already_listed" };
  if (await findPendingSubmission(ctx.db, username)) return { ok: false, error: "already_pending" };
  const since = ctx.now() - DAY_MS;
  if ((await countSubmissionsSince(ctx.db, input.tgUserId, since)) >= bot.submitDailyLimit) {
    return { ok: false, error: "daily_limit" };
  }
  return { ok: true, username };
}

/**
 * One-shot submission for the Mini App: the checks above, then t.me for what is being submitted,
 * then the row. The bot does the same thing across several messages, so it drives the steps itself
 * and only shares `checkSubmission`.
 */
export async function submitEntry(
  ctx: CoreContext,
  input: { tgUserId: number; username: string; categoryId: number; tagIds: number[] },
): Promise<{ ok: true; submissionId: number } | { ok: false; error: SubmitError }> {
  const allowed = await checkSubmission(ctx, input);
  if (!allowed.ok) return allowed;
  const { username } = allowed;

  const snap = await fetchEntrySnapshot(username, {
    fetch: ctx.fetch,
    now: new Date(ctx.now()),
    knownKind: null,
    needCreatedAt: false,
  });
  const kind = entryKinds.find((entryKind) => entryKind === snap.kind);
  // A user account, a dead link or a page t.me wouldn't show us is not something to review.
  if (snap.liveness !== "active" || !kind || !snap.profile) return { ok: false, error: "invalid" };

  const category = (await listCategories(ctx.db)).find((row) => row.id === input.categoryId);
  if (!category || category.kind !== kind) return { ok: false, error: "invalid" };
  const known = new Set((await listTags(ctx.db)).map((tag) => tag.id));
  const tagIds = [...new Set(input.tagIds)];
  if (tagIds.length > MAX_TAGS || tagIds.some((id) => !known.has(id))) {
    return { ok: false, error: "invalid" };
  }

  const submissionId = await createSubmission(ctx.db, {
    tgUserId: input.tgUserId,
    username,
    kind,
    categoryId: category.id,
    tagIds,
    fetchedTitle: snap.profile.title ?? username,
    fetchedDescription: snap.profile.description ?? "",
    fetchedMembers: snap.profile.members ?? snap.profile.monthlyUsers,
    createdAt: ctx.now(),
  });
  // Null means another submission for the same username landed first (unique partial index).
  if (submissionId === null) return { ok: false, error: "already_pending" };

  // This path writes straight to D1, so unlike the bot's chat flow nothing has told the reviewers
  // yet. Backgrounded and never awaited for correctness: a saved submission must not be lost
  // because a notification failed.
  await background(ctx, () =>
    notifyNewSubmission(ctx, {
      submissionId,
      username,
      kind,
      title: snap.profile?.title ?? username,
      categoryId: category.id,
      tagIds,
      submitterId: input.tgUserId,
    }),
  );
  return { ok: true, submissionId };
}

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
