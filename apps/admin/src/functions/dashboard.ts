import { env } from "cloudflare:workers";
import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { triggerBuild } from "@tgbox/core";
import { dashboardActivity } from "@tgbox/db";
import { queryKeys } from "@/lib/query-keys.ts";
import { adminMiddleware } from "@/server/middleware.ts";

const $getDashboardActivity = createServerFn({ method: "GET" })
  .middleware([adminMiddleware])
  .handler(async ({ context }) => {
    const activity = await dashboardActivity(context.core.db, { limit: 5 });
    return {
      ...activity,
      // `payload` is free-form JSON; the dashboard only shows the username most actions record.
      audit: activity.audit.map(({ payload, ...row }) => ({
        ...row,
        username: usernameOf(payload),
      })),
      buildEnabled: Boolean(env.GITHUB_REPO),
    };
  });

const usernameOf = (payload: unknown) =>
  typeof payload === "object" &&
  payload !== null &&
  "username" in payload &&
  typeof payload.username === "string"
    ? payload.username
    : null;

export const dashboardActivityQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.dashboardActivity,
    queryFn: ({ signal }) => $getDashboardActivity({ signal }),
    staleTime: 30_000,
  });

export const $triggerBuild = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .handler(({ context }) => triggerBuild(context.core, { actor: context.auth.actor }));
