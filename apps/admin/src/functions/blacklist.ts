import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { addBlacklist, removeBlacklist } from "@tgbox/core";
import { listBlacklist } from "@tgbox/db";
import { parseTelegramRef } from "@tgbox/shared";
import { z } from "zod";
import { queryKeys } from "@/lib/query-keys.ts";
import { adminMiddleware } from "@/server/middleware.ts";

const type = z.enum(["user", "username"]);

type AddBlacklistResult = { ok: true; value: string } | { ok: false; error: "invalid" | "exists" };

export const BLACKLIST_PAGE_SIZE = 50;

const $listBlacklist = createServerFn({ method: "GET" })
  .middleware([adminMiddleware])
  .inputValidator(z.object({ page: z.number().int().min(1) }))
  .handler(({ data, context }) =>
    listBlacklist(context.core.db, { page: data.page, pageSize: BLACKLIST_PAGE_SIZE }),
  );

export const blacklistQueryOptions = (page = 1) =>
  queryOptions({
    queryKey: [...queryKeys.blacklist, page],
    queryFn: ({ signal }) => $listBlacklist({ data: { page }, signal }),
  });

export type BlacklistPageData = Awaited<ReturnType<typeof $listBlacklist>>;
export type BlacklistRow = BlacklistPageData["rows"][number];

export const $addBlacklist = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .inputValidator(
    z.object({ type, value: z.string().trim().min(1).max(100), reason: z.string().max(200) }),
  )
  .handler(async ({ data, context }): Promise<AddBlacklistResult> => {
    // User ids are digits; usernames accept @name or t.me links like everywhere else.
    const value = data.type === "user" ? data.value : parseTelegramRef(data.value)?.toLowerCase();
    if (!value || (data.type === "user" && !/^\d{1,20}$/.test(value))) {
      return { ok: false, error: "invalid" };
    }
    const reason = data.reason.trim() || null;
    const added = await addBlacklist(context.core, {
      type: data.type,
      value,
      reason,
      actor: context.auth.actor,
    });
    return added ? { ok: true, value } : { ok: false, error: "exists" };
  });

export const $removeBlacklist = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .inputValidator(z.object({ type, value: z.string().min(1).max(100) }))
  .handler(({ data, context }) =>
    removeBlacklist(context.core, { ...data, actor: context.auth.actor }),
  );
