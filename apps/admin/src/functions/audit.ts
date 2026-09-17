import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { auditActions, triggerBuild } from "@tgbox/core";
import { getSiteState, listAuditActors, listAuditLogFiltered } from "@tgbox/db";
import { z } from "zod";
import { queryKeys } from "@/lib/query-keys.ts";
import { adminMiddleware } from "@/server/middleware.ts";

const AUDIT_PAGE_SIZE = 30;

const auditFilterSchema = z.object({
  action: z.enum(auditActions).optional(),
  actor: z.string().max(200).optional(),
});
export type AuditFilter = z.infer<typeof auditFilterSchema>;

const $listAudit = createServerFn({ method: "GET" })
  .middleware([adminMiddleware])
  .inputValidator(auditFilterSchema.extend({ cursor: z.number().int().optional() }))
  .handler(async ({ data, context }) => {
    const page = await listAuditLogFiltered(context.core.db, { ...data, limit: AUDIT_PAGE_SIZE });
    return {
      nextCursor: page.nextCursor,
      // The payload is free-form JSON; ship it pre-formatted.
      rows: page.rows.map((row) => ({
        ...row,
        payload: row.payload === null ? null : JSON.stringify(row.payload, null, 2),
      })),
    };
  });

export const auditQueryOptions = (filter: AuditFilter) =>
  infiniteQueryOptions({
    queryKey: [...queryKeys.audit, "log", filter],
    queryFn: ({ pageParam, signal }) =>
      $listAudit({ data: { ...filter, cursor: pageParam > 0 ? pageParam : undefined }, signal }),
    // 0 = first page; later pages pass the smallest id seen.
    initialPageParam: 0,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

export type AuditRow = Awaited<ReturnType<typeof $listAudit>>["rows"][number];

const $listAuditActors = createServerFn({ method: "GET" })
  .middleware([adminMiddleware])
  .handler(({ context }) => listAuditActors(context.core.db));

export const auditActorsQueryOptions = () =>
  queryOptions({
    queryKey: [...queryKeys.audit, "actors"],
    queryFn: ({ signal }) => $listAuditActors({ signal }),
    staleTime: 60_000,
  });

const timestamp = (value: string | undefined) => {
  const number = Number(value);
  return value === undefined || !Number.isFinite(number) ? null : number;
};

const $getBuildStatus = createServerFn({ method: "GET" })
  .middleware([adminMiddleware])
  .handler(async ({ context }) => {
    const { db, config } = context.core;
    const [dirtySince, lastBuildAt, lastTrigger] = await Promise.all([
      getSiteState(db, "dirty_since"),
      getSiteState(db, "last_build_at"),
      listAuditLogFiltered(db, { limit: 1, action: "build.trigger" }),
    ]);
    const trigger = lastTrigger.rows[0];
    return {
      dirtySince: timestamp(dirtySince),
      lastBuildAt: timestamp(lastBuildAt),
      lastTrigger: trigger ? { actor: trigger.actor, at: trigger.createdAt } : null,
      dispatchConfigured: config.GITHUB_REPO !== "",
    };
  });

export const buildStatusQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.buildStatus,
    queryFn: ({ signal }) => $getBuildStatus({ signal }),
  });

export const $triggerBuild = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .handler(({ context }) => triggerBuild(context.core, { actor: context.auth.actor }));
