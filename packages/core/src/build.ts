import { getSiteState, getSiteStates, markDirty, setSiteState } from "@tgbox/db";
import { audit } from "./audit.ts";
import { type Actor, background, type CoreContext } from "./context.ts";

/**
 * The repository is private, so every build spends GitHub Actions minutes: 2,000 a month on the
 * free plan, about 2.5 a build. A person's change is dispatched at once unless a build went out
 * less than this long ago; then it is held, and the 5-minute cron dispatches it once the spacing
 * is over (`dispatchHeldBuild`), so it is still on the site within about 20 minutes.
 */
const PERSON_SPACING_MS = 15 * 60_000;

/**
 * Contexts that already sent a dispatch. A context lives for one request or cron invocation, and
 * `build_dispatched_at` is only written once GitHub answers, so without this a bulk action changing
 * many rows faster than GitHub replies sent one dispatch per row, all against the same budget.
 */
const dispatched = new WeakSet<CoreContext>();

/**
 * Changes the crons find (member counts, translations) only mark the site dirty; the hourly net
 * publishes them once no build went out for this long. The scheduled workflow builds every six
 * hours too.
 */
const CRON_SPACING_MS = 3 * 60 * 60_000;

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
 * Marks the site dirty after a person's change and dispatches a build, unless one went out less
 * than `PERSON_SPACING_MS` ago: then the change is recorded as held (one write per held spell)
 * for `dispatchHeldBuild`.
 */
export async function markDirtyAndDispatch(ctx: CoreContext) {
  const now = ctx.now();
  await markDirty(ctx.db, now);
  // The build that dispatch starts exports D1 later, so it carries this change too.
  if (dispatched.has(ctx)) return;
  const state = await getSiteStates(ctx.db, ["build_dispatched_at", "build_held_at"]);
  const last = Number(state.build_dispatched_at);
  if (Number.isFinite(last) && now - last < PERSON_SPACING_MS) {
    const held = Number(state.build_held_at);
    if (!(Number.isFinite(held) && held > last)) {
      await setSiteState(ctx.db, "build_held_at", String(now));
    }
    return;
  }
  dispatched.add(ctx);
  await background(ctx, async () => {
    // A refused dispatch leaves the next change free to try again.
    if (!(await dispatchBuild(ctx))) dispatched.delete(ctx);
  });
}

/**
 * 5-minute cron: dispatches a person's change that `markDirtyAndDispatch` held back, once the
 * spacing is over. One D1 read when nothing is held.
 */
export async function dispatchHeldBuild(ctx: CoreContext) {
  const state = await getSiteStates(ctx.db, [
    "dirty_since",
    "build_dispatched_at",
    "build_held_at",
  ]);
  const held = Number(state.build_held_at);
  if (state.dirty_since === undefined || !Number.isFinite(held)) return false;
  const last = Number(state.build_dispatched_at);
  if (Number.isFinite(last) && (held <= last || ctx.now() - last < PERSON_SPACING_MS)) return false;
  return await dispatchBuild(ctx);
}

/**
 * Hourly safety net: dispatches when the site has been dirty with no dispatch for `staleMs`, which
 * is how the crons' own changes are published, and why a failed dispatch can't strand a change.
 */
export async function dispatchStaleBuild(ctx: CoreContext, staleMs = CRON_SPACING_MS) {
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
