import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { adminStats } from "@tgbox/db";
import { queryKeys } from "@/lib/query-keys.ts";
import { adminMiddleware } from "@/server/middleware.ts";

const $getAdminStats = createServerFn({ method: "GET" })
  .middleware([adminMiddleware])
  .handler(({ context }) => adminStats(context.core.db, context.core.now()));

export const adminStatsQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.adminStats,
    queryFn: ({ signal }) => $getAdminStats({ signal }),
    staleTime: 30_000,
  });
