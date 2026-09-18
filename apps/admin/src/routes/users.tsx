import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { UsersPage, userTabs } from "@/features/users/users-page.tsx";

export const Route = createFileRoute("/users")({
  validateSearch: z.object({ tab: z.enum(userTabs).catch("list").default("list") }),
  component: Page,
});

function Page() {
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <UsersPage
      tab={tab}
      onTabChange={(next) => navigate({ search: { tab: next }, replace: true })}
    />
  );
}
