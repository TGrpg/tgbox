import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/shell/page-header.tsx";
import { BlacklistPage } from "@/features/blacklist/blacklist-page.tsx";

export const Route = createFileRoute("/blacklist")({
  component: Page,
});

function Page() {
  return (
    <>
      <PageHeader
        title="黑名单"
        description="被拉黑的用户会被机器人忽略；被拉黑的用户名无法投稿或收录。"
      />
      <BlacklistPage />
    </>
  );
}
