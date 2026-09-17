import { markDirty } from "@tgbox/db";
import { audit } from "./audit.ts";
import { type Actor, background, type CoreContext } from "./context.ts";

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
  if (!res.ok) console.error("github dispatch failed", res.status);
  return res.ok;
}

/** Marks the site dirty and, on the clean → dirty transition, dispatches a site build. */
export async function markDirtyAndDispatch(ctx: CoreContext) {
  if (await markDirty(ctx.db, ctx.now())) await background(ctx, () => dispatchBuild(ctx));
}

/** Manual "build now": dispatches even when the site was already dirty. */
export async function triggerBuild(ctx: CoreContext, input: { actor: Actor }) {
  await markDirty(ctx.db, ctx.now());
  await audit(ctx, input.actor, "build.trigger", null);
  return { dispatched: await dispatchBuild(ctx) };
}
