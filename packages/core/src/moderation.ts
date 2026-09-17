import { getEntryByUsername, setEntryHidePosts, setPostHidden } from "@tgbox/db";
import { parseTelegramRef } from "@tgbox/shared";
import { audit } from "./audit.ts";
import { markDirtyAndDispatch } from "./build.ts";
import type { Actor, CoreContext } from "./context.ts";

export type ModerationError = "invalid_username" | "not_found";

type Result =
  | { ok: true; entryId: number; changed: boolean }
  | { ok: false; error: ModerationError };

async function entryOf(ctx: CoreContext, username: string) {
  const parsed = parseTelegramRef(username);
  if (!parsed) return { ok: false, error: "invalid_username" } as const;
  const entry = await getEntryByUsername(ctx.db, parsed);
  if (!entry) return { ok: false, error: "not_found" } as const;
  return { ok: true, entry } as const;
}

/** Hides or shows every post preview of one entry on the site. */
export async function setEntryPostsVisibility(
  ctx: CoreContext,
  input: { actor: Actor; username: string; hide: boolean },
): Promise<Result> {
  const found = await entryOf(ctx, input.username);
  if (!found.ok) return found;
  const { entry } = found;
  const changed = await setEntryHidePosts(ctx.db, {
    entryId: entry.id,
    hide: input.hide,
    now: ctx.now(),
  });
  if (changed) {
    await audit(ctx, input.actor, "entry.posts", `entry:${entry.id}`, {
      username: entry.username,
      hide: input.hide,
    });
    await markDirtyAndDispatch(ctx);
  }
  return { ok: true, entryId: entry.id, changed };
}

/** Hides or shows a single post preview of one entry. */
export async function setPostVisibility(
  ctx: CoreContext,
  input: { actor: Actor; username: string; postId: number; hidden: boolean },
): Promise<Result> {
  const found = await entryOf(ctx, input.username);
  if (!found.ok) return found;
  const { entry } = found;
  const changed = await setPostHidden(ctx.db, {
    entryId: entry.id,
    postId: input.postId,
    hidden: input.hidden,
    now: ctx.now(),
  });
  if (changed) {
    await audit(ctx, input.actor, "post.hidden", `entry:${entry.id}`, {
      username: entry.username,
      postId: input.postId,
      hidden: input.hidden,
    });
    await markDirtyAndDispatch(ctx);
  }
  return { ok: true, entryId: entry.id, changed };
}
