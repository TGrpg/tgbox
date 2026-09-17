import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { PromotionsPage, promotionTabs } from "@/features/promotions/promotions-page.tsx";

export const Route = createFileRoute("/promotions")({
  validateSearch: z.object({ tab: z.enum(promotionTabs).catch("orders").default("orders") }),
  component: Page,
});

function Page() {
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <PromotionsPage
      tab={tab}
      onTabChange={(next) => navigate({ search: { tab: next }, replace: true })}
    />
  );
}
