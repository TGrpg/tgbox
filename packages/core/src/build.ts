import { getSiteState, getSiteStates, markDirty, setSiteState } from "@tgbox/db";
import { audit } from "./audit.ts";
import { type Actor, background, type CoreContext } from "./context.ts";

/**
 * A change by a person should be on the site within minutes, so a dispatch is only skipped when
 * another one just went out.
 */
const DEFAULT_MIN_INTERVAL_MS = 3 * 60_000;

/** Nothing may stay unpublished longer than an hour, so the hourly net acts on half that. */
const STALE_DISPATCH_MS = 30 * 60_000;

/** Dispatches the build workflow. Records `build_dispatched_at` only when GitHub accepted it. */
async function dispatchBuild(ctx: CoreContext) {
  const { GITHUB_REPO, GITHUB_DISPATCH_TOKEN } = ctx.config;
  if (!GITHUB_REPO) return false;
  const res = await ctx.fetch(`https://api.github.com/repos/${GITHUB_REPO}/dispatches`, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${GITHUB_DISPATCH_TOKEN}`,
      "content-type": "application/json",
      "user-agent": "tgbox",
    },
    // The workflow only builds when `dirty_since` is set, so every dispatch follows markDirty.
    body: JSON.stringify({ event_type: "content-changed" }),
  });
  if (!res.ok) {
    // GitHub explains the refusal in the body ("Bad credentials", "Resource not accessible…");
    // the status alone can't tell a bad token from a missing repo in Workers Logs.
    console.error("github dispatch failed", res.status, await dispatchMessage(res));
    return false;
  }
  await setSiteState(ctx.db, "build_dispatched_at", String(ctx.now()));
  return true;
}

async function dispatchMessage(res: Response) {
  const body = await res.text().catch(() => "");
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === "object" && "message" in parsed) return String(parsed.message);
  } catch {
    // Not JSON (a proxy error page, say): the raw text is the best hint available.
  }
  return body.slice(0, 200);
}

/**
 * Marks the site dirty and dispatches a build unless one went out recently.
 *
 * The flag alone can't decide: `dirty_since` stays set until the workflow clears it, so "already
 * dirty" may mean a cron-detected change nobody dispatched hours ago — while "not dirty yet" is
 * the normal state right after any build, which makes every change look like a fresh transition.
 * The throttle therefore runs on `build_dispatched_at`, and `onTransition` decides whether a
 * change that flips the flag may skip it.
 */
export async function markDirtyAndDispatch(
  ctx: CoreContext,
  options: {
    minIntervalMs?: number;
    /** Dispatch immediately when this change flips the flag. Off for cron-detected changes. */
    onTransition?: boolean;
  } = {},
) {
  const { minIntervalMs = DEFAULT_MIN_INTERVAL_MS, onTransition = true } = options;
  const now = ctx.now();
  const transitioned = await markDirty(ctx.db, now);
  if (!(transitioned && onTransition)) {
    const last = Number(await getSiteState(ctx.db, "build_dispatched_at"));
    // Still dirty, so the change isn't lost: the next eligible dispatch or the hourly net takes it.
    if (Number.isFinite(last) && now - last < minIntervalMs) return;
  }
  await background(ctx, () => dispatchBuild(ctx));
}

/**
 * Hourly safety net: dispatches when the site has been dirty with no dispatch for `staleMs`,
 * so a failed or skipped dispatch can't leave a change unpublished until the next scheduled build.
 */
export async function dispatchStaleBuild(ctx: CoreContext, staleMs = STALE_DISPATCH_MS) {
  const state = await getSiteStates(ctx.db, ["dirty_since", "build_dispatched_at"]);
  if (state.dirty_since === undefined) return false;
  const last = Number(state.build_dispatched_at);
  if (Number.isFinite(last) && ctx.now() - last < staleMs) return false;
  return await dispatchBuild(ctx);
}

/** Manual "build now": dispatches even when the site was already dirty. */
export async function triggerBuild(ctx: CoreContext, input: { actor: Actor }) {
  await markDirty(ctx.db, ctx.now());
  await audit(ctx, input.actor, "build.trigger", null);
  return { dispatched: await dispatchBuild(ctx) };
}
