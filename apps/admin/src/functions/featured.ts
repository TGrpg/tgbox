import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { getSettings, setFeatured } from "@tgbox/core";
import { queryKeys } from "@/lib/query-keys.ts";
import { FeaturedInput } from "@/server/featured.ts";
import { adminMiddleware } from "@/server/middleware.ts";

const $getFeatured = createServerFn({ method: "GET" })
  .middleware([adminMiddleware])
  .handler(async ({ context }) => (await getSettings(context.core)).site.featured);

export const featuredQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.featured,
    queryFn: ({ signal }) => $getFeatured({ signal }),
  });

export const $saveFeatured = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .inputValidator(FeaturedInput)
  .handler(({ data, context }) =>
    setFeatured(context.core, { featured: data.featured, actor: context.auth.actor }),
  );
