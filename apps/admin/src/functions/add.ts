import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { listEntryManually, previewEntry } from "@tgbox/core";
import { findPendingSubmission, getBlacklistEntry } from "@tgbox/db";
import { parseTelegramRef } from "@tgbox/shared";
import { z } from "zod";
import { adminMiddleware } from "@/server/middleware.ts";

const usernameInput = z.string().trim().min(1).max(200);

/** Read-only: fetches the t.me profile and reports duplicates. */
export const $previewEntry = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .inputValidator(z.object({ username: usernameInput }))
  .handler(({ data, context }) =>
    previewEntry(context.core, { username: data.username, ai: env.AI }),
  );

export const $listEntry = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .inputValidator(
    z.object({
      username: usernameInput,
      categorySlug: z.string().min(1).max(64),
      tagSlugs: z.array(z.string().min(1).max(64)).max(20),
    }),
  )
  .handler(async ({ data, context }) => {
    const { db } = context.core;
    const username = parseTelegramRef(data.username);
    // A pending submission goes through review; blacklisted names are never listed.
    if (username && (await findPendingSubmission(db, username))) {
      return { ok: false as const, error: "pending_submission" as const };
    }
    if (username && (await getBlacklistEntry(db, "username", username))) {
      return { ok: false as const, error: "blacklisted" as const };
    }
    return listEntryManually(context.core, { ...data, actor: context.auth.actor });
  });
