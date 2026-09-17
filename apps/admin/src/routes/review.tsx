import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ReviewQueue } from "@/features/review/review-queue.tsx";
import { reviewTabs } from "@/functions/review.ts";

export const Route = createFileRoute("/review")({
  validateSearch: z.object({ tab: z.enum(reviewTabs).catch("pending").default("pending") }),
  component: Page,
});

function Page() {
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <ReviewQueue
      tab={tab}
      onTabChange={(next) => navigate({ search: { tab: next }, replace: true })}
    />
  );
}
