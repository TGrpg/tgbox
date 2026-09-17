import type { QueryClient } from "@tanstack/react-query";

/**
 * Root query keys shared by every page. A query key starts with its root so one invalidation
 * reaches every variant (pages, filters) of that list.
 */
export const queryKeys = {
  session: ["session"],
  taxonomy: ["taxonomy"],
  entries: ["entries"],
  entryTags: ["entry-tags"],
  audit: ["audit"],
  adminStats: ["admin-stats"],
  dashboardActivity: ["dashboard-activity"],
  buildStatus: ["build-status"],
  blacklist: ["blacklist"],
  reviewQueue: ["review-queue"],
  submissionPreview: ["submission-preview"],
  settings: ["settings"],
  orders: ["orders"],
  promotions: ["promotions"],
  promotionCounts: ["promotion-counts"],
  products: ["products"],
} as const;

export type QueryKeyRoot = keyof typeof queryKeys;

export const invalidate = (client: QueryClient, ...roots: QueryKeyRoot[]) =>
  Promise.all(roots.map((root) => client.invalidateQueries({ queryKey: queryKeys[root] })));
