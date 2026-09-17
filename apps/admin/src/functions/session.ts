import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { queryKeys } from "@/lib/query-keys.ts";
import { adminMiddleware } from "@/server/middleware.ts";

const $getSession = createServerFn({ method: "GET" })
  .middleware([adminMiddleware])
  .handler(({ context }) => context.auth);

export const sessionQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.session,
    queryFn: ({ signal }) => $getSession({ signal }),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
