import { createFileRoute } from "@tanstack/react-router";
import { useCallback } from "react";
import { EntriesPage } from "@/features/entries/entries-page.tsx";
import { type EntriesSearch, entriesSearchSchema } from "@/features/entries/search.ts";

export const Route = createFileRoute("/entries")({
  validateSearch: entriesSearchSchema,
  component: Page,
});

function Page() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const setSearch = useCallback(
    (patch: Partial<EntriesSearch>) =>
      navigate({
        search: (prev) => ({ ...prev, page: undefined, ...patch }),
        replace: true,
      }),
    [navigate],
  );
  return <EntriesPage search={search} setSearch={setSearch} />;
}
