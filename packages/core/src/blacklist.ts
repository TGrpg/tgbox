import { addToBlacklist, type BlacklistType, removeFromBlacklist } from "@tgbox/db";
import { audit } from "./audit.ts";
import type { Actor, CoreContext } from "./context.ts";

/** Returns false if the value was already blacklisted. */
export async function addBlacklist(
  ctx: CoreContext,
  input: { type: BlacklistType; value: string; reason: string | null; actor: Actor },
) {
  const added = await addToBlacklist(ctx.db, { ...input, now: ctx.now() });
  if (added) {
    await audit(ctx, input.actor, "blacklist.add", `blacklist:${input.type}:${input.value}`, {
      value: input.value,
      reason: input.reason,
    });
  }
  return added;
}

/** Returns false if the value was not blacklisted. */
export async function removeBlacklist(
  ctx: CoreContext,
  input: { type: BlacklistType; value: string; actor: Actor },
) {
  const removed = await removeFromBlacklist(ctx.db, input.type, input.value);
  if (removed) {
    await audit(ctx, input.actor, "blacklist.remove", `blacklist:${input.type}:${input.value}`, {
      value: input.value,
    });
  }
  return removed;
}
