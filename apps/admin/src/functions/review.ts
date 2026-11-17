import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import {
  approveSubmissions,
  previewSubmission,
  rejectReasons,
  rejectSubmissions,
} from "@tgbox/core";
import { listSubmissions } from "@tgbox/db";
import { z } from "zod";
import { queryKeys } from "@/lib/query-keys.ts";
import { adminMiddleware } from "@/server/middleware.ts";

export const reviewTabs = ["pending", "approved", "rejected"] as const;
export type ReviewTab = (typeof reviewTabs)[number];

/** Most rows the review page acts on at once; the client splits them into requests below. */
export const MAX_BULK = 20;

/**
 * Per request, against the 50-subrequest limit (authentication takes one or two more). An approval
 * costs up to 16: submission read, up to three t.me pages, entry lookup and insert, transition,
 * audit, dirty flag, dispatch throttle read, the channel post (settings, entry and categories
 * reads, the send) and the submitter's notice (their language, the send). Three come to 47 with
 * the request's one build dispatch. A rejection costs 5: read, transition, audit, the notice.
 */
export const APPROVE_PER_REQUEST = 3;
export const REJECT_PER_REQUEST = 8;

const ids = (max: number) => z.array(z.number().int().positive()).min(1).max(max);

const $listReviewQueue = createServerFn({ method: "GET" })
  .middleware([adminMiddleware])
  .inputValidator(z.object({ status: z.enum(reviewTabs), page: z.number().int().min(1) }))
  .handler(({ data, context }) =>
    listSubmissions(context.core.db, { status: data.status, page: data.page, pageSize: 50 }),
  );

export const reviewQueueQueryOptions = (status: ReviewTab, page = 1) =>
  queryOptions({
    queryKey: [...queryKeys.reviewQueue, status, page],
    queryFn: ({ signal }) => $listReviewQueue({ data: { status, page }, signal }),
  });

const $previewSubmission = createServerFn({ method: "GET" })
  .middleware([adminMiddleware])
  .inputValidator(
    z.object({
      username: z.string().regex(/^[A-Za-z0-9_]{3,32}$/),
      kind: z.enum(["channel", "group", "bot"]),
    }),
  )
  .handler(({ data, context }) => previewSubmission(context.core, data));

export const submissionPreviewQueryOptions = (
  username: string,
  kind: "channel" | "group" | "bot",
) =>
  queryOptions({
    queryKey: [...queryKeys.submissionPreview, username],
    queryFn: ({ signal }) => $previewSubmission({ data: { username, kind }, signal }),
    staleTime: 5 * 60_000,
    retry: false,
  });

export const $approveSubmissions = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .inputValidator(z.object({ ids: ids(APPROVE_PER_REQUEST) }))
  .handler(({ data, context }) =>
    approveSubmissions(context.core, { ids: data.ids, actor: context.auth.actor }),
  );

export const $rejectSubmissions = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .inputValidator(z.object({ ids: ids(REJECT_PER_REQUEST), reason: z.enum(rejectReasons) }))
  .handler(({ data, context }) =>
    rejectSubmissions(context.core, {
      ids: data.ids,
      reason: data.reason,
      actor: context.auth.actor,
    }),
  );
